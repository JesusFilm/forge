import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => []),
  }
  return { prisma: mock, syncPrisma: mock }
})

vi.mock("@/services/core-id-mapping.service", () => ({
  loadCoreIdMapping: vi.fn(async () => ({
    generatedAt: "2026-04-22T00:00:00.000Z",
    byCoreId: new Map<string, number>([
      ["core-a", 1],
      ["core-b", 2],
    ]),
  })),
}))

vi.mock("@/services/transcript-embedding.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/transcript-embedding.service")
    >()
  return {
    ...actual, // keep the real TranscriptIndexError class reachable
    indexEditionTranscript: vi.fn(async () => ({
      editionId: "edition-stub",
      language: "en",
      chunksIndexed: 3,
      embeddingsWritten: 3,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })),
  }
})

const { prisma } = await import("@/db/client")
const { indexEditionTranscript, TranscriptIndexError } =
  await import("@/services/transcript-embedding.service")
const { ManagerArtifactError } =
  await import("@/services/manager-artifacts.service")
const { runTranscriptEmbeddingBackfill, _internals } =
  await import("./transcriptEmbeddingBackfill")

type PrismaStub = { $queryRaw: ReturnType<typeof vi.fn> }

function row(
  videoId: string,
  editionId: string,
  coreId: string,
  bcp47: string,
) {
  return {
    video_id: videoId,
    video_edition_id: editionId,
    core_id: coreId,
    bcp47,
  }
}

describe("runTranscriptEmbeddingBackfill", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionTranscript).mockClear()
  })

  it("enumerates (video, edition) pairs and indexes one transcript per target", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(2)
    expect(report.succeeded).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.failed).toBe(0)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(2)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "e-a",
        videoId: "v-a",
        coreId: "core-a",
        cmsVideoId: 1,
        language: "en",
      }),
    )
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "e-b",
        videoId: "v-b",
        coreId: "core-b",
        cmsVideoId: 2,
        language: "es",
      }),
    )
  })

  it("produces one target per (edition, language) pair for multi-language editions", async () => {
    // A single edition exposed in three languages (one primary, one
    // dubbed, one subtitled) should produce three distinct targets,
    // not one. The SQL enumeration returns one row per triple; the
    // workflow indexes each.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(3)
    const languagesCalled = vi
      .mocked(indexEditionTranscript)
      .mock.calls.map((c) => (c[1] as { language: string }).language)
      .sort()
    expect(languagesCalled).toEqual(["en", "es", "fr"])
  })

  it("applies the coreIds filter", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-b"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b" }),
    )
  })

  it("languages filter is a strict inclusion list — no hardcoded fallback defaults apply", async () => {
    // Confirm the data-derived enumeration: if the SQL returns a row
    // for (core-a, es) but the caller's filter is ["en"], the target
    // is dropped. No "primary language unset → default to en" rescue.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: ["en"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
    expect(indexEditionTranscript).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b", language: "en" }),
    )
  })

  it("applies the languages filter to narrow which targets get indexed", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "es"),
      row("v-c", "e-c", "core-a", "fr"), // same coreId as v-a
    ])

    // Mapping only knows core-a and core-b; v-c survives because
    // core-a is mapped. After the language filter, only en + es stay.
    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: ["en", "es"],
    })

    expect(report.totalTargets).toBe(2)
    expect(report.languageFilter).toEqual(["en", "es"])
    expect(indexEditionTranscript).toHaveBeenCalledTimes(2)
    const calls = vi
      .mocked(indexEditionTranscript)
      .mock.calls.map((c) => (c[1] as { language: string }).language)
    expect(calls.sort()).toEqual(["en", "es"])
  })

  it("skips targets whose coreId is absent from the mapping", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-z", "e-z", "unmapped-core-z", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionTranscript).toHaveBeenCalledTimes(1)
  })

  it("converts artifact_missing errors to skipped outcomes", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "embeddings artifact not found for assetId=1",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.outcomes[0]?.status).toBe("skipped")
  })

  it("does not demote unrelated errors mentioning 'not found' to skipped", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new Error("Record to update not found."),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("classifies TranscriptIndexError dimension_mismatch as failed", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    // Use the real TranscriptIndexError so a future refactor that
    // switches the workflow to branch by `instanceof` stays covered.
    vi.mocked(indexEditionTranscript).mockRejectedValueOnce(
      new TranscriptIndexError(
        "dimension_mismatch",
        "artifact reports dimensions=768",
      ),
    )

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    const outcome = report.outcomes[0]
    expect(outcome?.status).toBe("failed")
    if (outcome?.status === "failed") {
      expect(outcome.reason).toContain("dimensions=768")
    }
  })

  it("records failed outcomes but keeps processing other targets", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(indexEditionTranscript)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        editionId: "e-b",
        language: "en",
        chunksIndexed: 2,
        embeddingsWritten: 2,
        chunksPruned: 0,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      })

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("treats coreIds: [] as omitted (runs all mapped targets)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
    })

    expect(report.totalTargets).toBe(2)
  })

  it("treats languages: [] as omitted (no filter applied)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      languages: [],
    })

    expect(report.totalTargets).toBe(1)
    expect(report.languageFilter).toBeNull()
  })

  it("returns an empty report when the DB has no editions", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])
    const report = await runTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })
    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(indexEditionTranscript).not.toHaveBeenCalled()
  })
})

describe("_internals.stepReport", () => {
  it("aggregates mixed outcomes correctly", () => {
    const target = {
      videoId: "v",
      videoEditionId: "e",
      coreId: "core",
      cmsVideoId: 1,
      language: "en",
    }
    const report = _internals.stepReport({
      mappingGeneratedAt: "2026-04-22T00:00:00.000Z",
      targets: 3,
      languageFilter: null,
      outcomes: [
        {
          status: "succeeded",
          target,
          language: "en",
          chunksIndexed: 3,
          embeddingsWritten: 3,
          chunksPruned: 0,
          durationMs: 100,
        },
        {
          status: "failed",
          target,
          language: "en",
          reason: "boom",
          durationMs: 50,
        },
        {
          status: "skipped",
          target,
          language: "en",
          reason: "artifact_missing",
          durationMs: 5,
        },
      ],
    })
    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(1)
  })
})
