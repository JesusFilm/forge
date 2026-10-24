import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "./content-embedding-contract"

const { writeExperiencePayloadMock } = vi.hoisted(() => ({
  writeExperiencePayloadMock: vi.fn(),
}))

vi.mock("@/services/embeddings.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/embeddings.service")>()
  return {
    ...actual,
    writeExperienceEmbeddingPayloadInTransaction: writeExperiencePayloadMock,
  }
})

const { ingestExperienceEmbedding } =
  await import("@/services/experience-embedding-ingest.service")
const { buildExperienceEmbeddingSource } =
  await import("@/services/embeddings.service")

function activeContractRow() {
  return {
    pointerId: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
    contractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
    queryProvider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
    queryModel: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
    queryNativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryTransformVersion: null,
    storageProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
    storageModel: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
    storageNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageTransformVersion: null,
  }
}

function vector(seed = 1): number[] {
  return Array.from(
    { length: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS },
    (_, index) => seed + index / 1000,
  )
}

function localeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "loc-1",
    experienceId: "exp-1",
    locale: "en",
    slug: "hope",
    status: "PUBLISHED",
    title: "Hope",
    metaDescription: "A story of hope.",
    ogTitle: null,
    ogDescription: null,
    blocks: [{ t: "paragraph", text: "Jesus brings hope." }],
    experience: { archivedAt: null },
    ...overrides,
  }
}

function buildPayload(overrides: Record<string, unknown> = {}) {
  const source = buildExperienceEmbeddingSource(localeRow())
  return {
    target: {
      experienceId: "exp-1",
      experienceLocaleId: "loc-1",
      locale: "en",
      slug: "hope",
    },
    source: {
      contentHash: source.contentHash,
      summary: source.summary,
    },
    model: {
      name: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
      provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-26T00:00:00.000Z",
      mastraRunId: "run-1",
    },
    embedding: vector(),
    ...overrides,
  }
}

function existing(overrides: Record<string, unknown> = {}) {
  return {
    healthy: true,
    source_content_hash: buildPayload().source.contentHash,
    source_summary: buildPayload().source.summary,
    model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
    dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
    native_dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    transform_version: null,
    ...overrides,
  }
}

function buildPrisma(row = localeRow()) {
  const queryRaw = vi.fn(
    async (strings: TemplateStringsArray): Promise<unknown[]> => {
      const sql = strings.join(" ")
      if (sql.includes("FROM content_embedding_contract_pointer")) {
        return [activeContractRow()]
      }
      return []
    },
  )
  const findUnique = vi.fn(async () => row)
  const prisma: {
    experienceLocale: { findUnique: typeof findUnique }
    $queryRaw: typeof queryRaw
    $transaction: ReturnType<typeof vi.fn>
  } = {
    experienceLocale: { findUnique },
    $queryRaw: queryRaw,
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(
    async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  )
  return prisma
}

function mockExistingExperienceSummary(
  prisma: ReturnType<typeof buildPrisma>,
  existingRow: Record<string, unknown> | null,
) {
  vi.mocked(prisma.$queryRaw).mockImplementation(
    async (strings: TemplateStringsArray): Promise<unknown[]> => {
      const sql = strings.join(" ")
      if (sql.includes("FROM content_embedding_contract_pointer")) {
        return [activeContractRow()]
      }
      if (sql.includes("FROM experience_locale")) {
        return existingRow == null ? [] : [existingRow]
      }
      return []
    },
  )
}

describe("ingestExperienceEmbedding", () => {
  beforeEach(() => {
    writeExperiencePayloadMock.mockReset()
    writeExperiencePayloadMock.mockResolvedValue(undefined)
  })

  it("writes a valid Mastra-shaped experience payload with provenance", async () => {
    const prisma = buildPrisma()

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload(),
    )

    expect(result).toMatchObject({
      status: "created",
      target: {
        experienceId: "exp-1",
        experienceLocaleId: "loc-1",
        locale: "en",
      },
      dimensions: 1536,
      mastraRunId: "run-1",
    })
    expect(writeExperiencePayloadMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        localeId: "loc-1",
        embedding: vector(),
        provenance: expect.objectContaining({
          sourceContentHash: buildPayload().source.contentHash,
          sourceSummary: buildPayload().source.summary,
          provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
          nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          transformVersion: undefined,
          generationMode: "idempotent",
          mastraRunId: "run-1",
        }),
      }),
    )
  })

  it("returns unchanged when idempotent mode sees healthy matching provenance", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(prisma, existing())

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload(),
    )

    expect(result.status).toBe("unchanged")
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("rejects idempotent writes when existing provenance differs", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(
      prisma,
      existing({ source_content_hash: "sha256:old" }),
    )

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload(),
    )

    expect(result).toMatchObject({
      status: "rejected",
      reason: "existing_experience_embedding_differs",
    })
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("rejects idempotent writes when stale or incomplete provenance exists without a vector", async () => {
    const stale = buildPrisma()
    mockExistingExperienceSummary(
      stale,
      existing({ healthy: false, source_content_hash: "sha256:old" }),
    )

    await expect(
      ingestExperienceEmbedding(stale as never, buildPayload()),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "existing_experience_embedding_differs",
    })

    const incomplete = buildPrisma()
    mockExistingExperienceSummary(incomplete, existing({ healthy: false }))

    await expect(
      ingestExperienceEmbedding(incomplete as never, buildPayload()),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "existing_experience_embedding_incomplete",
    })
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("repair mode rewrites when provenance matches but vector is missing", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(prisma, existing({ healthy: false }))

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload({
        generation: {
          mode: "repair",
          generatedAt: "2026-05-26T00:00:00.000Z",
          mastraRunId: "run-repair",
        },
      }),
    )

    expect(result.status).toBe("repaired")
    expect(writeExperiencePayloadMock).toHaveBeenCalledTimes(1)
  })

  it("repair mode leaves healthy matching vectors unchanged", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(prisma, existing())

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload({
        generation: {
          mode: "repair",
          generatedAt: "2026-05-26T00:00:00.000Z",
          mastraRunId: "run-repair-healthy",
        },
      }),
    )

    expect(result.status).toBe("unchanged")
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("model-upgrade mode rewrites healthy vectors with model-upgraded status", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(prisma, existing())

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload({
        generation: {
          mode: "model-upgrade",
          generatedAt: "2026-05-26T00:00:00.000Z",
          mastraRunId: "run-model-upgrade",
        },
      }),
    )

    expect(result.status).toBe("model_upgraded")
    expect(writeExperiencePayloadMock).toHaveBeenCalledTimes(1)
  })

  it("repair mode rejects missing vectors when provenance differs", async () => {
    const prisma = buildPrisma()
    mockExistingExperienceSummary(
      prisma,
      existing({ healthy: false, source_content_hash: "sha256:old" }),
    )

    const result = await ingestExperienceEmbedding(
      prisma as never,
      buildPayload({
        generation: {
          mode: "repair",
          generatedAt: "2026-05-26T00:00:00.000Z",
          mastraRunId: "run-repair",
        },
      }),
    )

    expect(result).toMatchObject({
      status: "rejected",
      reason: "repair_requires_matching_provenance",
    })
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("rejects unpublished, archived, or stale source targets before writing", async () => {
    await expect(
      ingestExperienceEmbedding(
        buildPrisma(localeRow({ status: "DRAFT" })) as never,
        buildPayload(),
      ),
    ).rejects.toMatchObject({ code: "target_unpublished" })

    await expect(
      ingestExperienceEmbedding(
        buildPrisma(
          localeRow({ experience: { archivedAt: new Date("2026-01-01") } }),
        ) as never,
        buildPayload(),
      ),
    ).rejects.toMatchObject({ code: "target_not_found" })

    await expect(
      ingestExperienceEmbedding(
        buildPrisma(
          localeRow({
            blocks: [{ t: "paragraph", text: "Changed after Mastra launch." }],
          }),
        ) as never,
        buildPayload(),
      ),
    ).rejects.toMatchObject({ code: "source_hash_mismatch" })
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })

  it("rejects dimension drift before writing rows", async () => {
    const prisma = buildPrisma()

    await expect(
      ingestExperienceEmbedding(
        prisma as never,
        buildPayload({ embedding: [0.1] }),
      ),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(writeExperiencePayloadMock).not.toHaveBeenCalled()
  })
})
