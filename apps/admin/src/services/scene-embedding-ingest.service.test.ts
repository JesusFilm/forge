import { beforeEach, describe, expect, it, vi } from "vitest"

const { writeSceneEmbeddingPayloadMock } = vi.hoisted(() => ({
  writeSceneEmbeddingPayloadMock: vi.fn(),
}))

vi.mock("@/services/scene-embedding.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/scene-embedding.service")>()
  return {
    ...actual,
    writeSceneEmbeddingPayloadInTransaction: writeSceneEmbeddingPayloadMock,
  }
})

const { ingestSceneEmbeddings, _internals } =
  await import("@/services/scene-embedding-ingest.service")

function buildPrisma() {
  const queryRaw = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [])
  const findVideo = vi.fn(
    async (): Promise<{ id: string; coreId: string } | null> => ({
      id: "video-1",
      coreId: "core-1",
    }),
  )
  const findEdition = vi.fn(
    async (): Promise<{ id: string } | null> => ({ id: "edition-1" }),
  )
  const prisma: {
    video: { findFirst: typeof findVideo }
    videoEdition: { findFirst: typeof findEdition }
    $queryRaw: typeof queryRaw
    $transaction: ReturnType<typeof vi.fn>
  } = {
    video: { findFirst: findVideo },
    videoEdition: { findFirst: findEdition },
    $queryRaw: queryRaw,
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(
    async <T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> => fn(prisma),
  )
  return prisma
}

function vector(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, index) => seed + index / 1000)
}

function payload(overrides?: Record<string, unknown>) {
  const body = {
    target: {
      admin: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
    },
    locale: "en",
    source: {
      artifactKey: "42/scene-analysis.json",
      artifactVersion: "manager-scene-analysis-v1",
      provider: "manager",
      generatedAt: "2026-05-25T00:00:00.000Z",
    },
    model: {
      name: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-25T00:01:00.000Z",
      mastraRunId: "run-1",
    },
    scenes: [
      {
        sceneIndex: 0,
        startSeconds: 0,
        endSeconds: 30,
        chapterTitle: "Intro",
        sourceText: "Themes: hope.\nContent: An opening scene.",
        description: "Themes: hope.\nContent: An opening scene.",
        themes: ["hope"],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
        embedding: vector(1),
      },
    ],
    ...overrides,
  }
  const source = body.source as Record<string, unknown>
  source.contentHash ??= hashFor(body)
  return body
}

function hashFor(body: ReturnType<typeof payload>): string {
  return _internals.sha256Json({
    locale: body.locale,
    scenes: (
      body.scenes as Array<{
        sceneIndex: number
        startSeconds: number
        endSeconds?: number
        sourceText: string
        description: string
        themes?: string[]
        bibleVerses?: string[]
        demographics?: string[]
        spiritualContext?: string[]
      }>
    ).map((scene) => ({
      sceneIndex: scene.sceneIndex,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds ?? null,
      sourceText: scene.sourceText,
      description: scene.description,
      themes: scene.themes ?? [],
      bibleVerses: scene.bibleVerses ?? [],
      demographics: scene.demographics ?? [],
      spiritualContext: scene.spiritualContext ?? [],
    })),
  })
}

function existingSummary(overrides: Record<string, unknown> = {}) {
  return {
    row_count: 1,
    healthy_count: 1,
    source_hash_count: 1,
    source_hashes: ["sha256:test"],
    models: ["openai/text-embedding-3-small"],
    dimensions: [1536],
    ...overrides,
  }
}

describe("ingestSceneEmbeddings", () => {
  beforeEach(() => {
    writeSceneEmbeddingPayloadMock.mockReset()
    writeSceneEmbeddingPayloadMock.mockResolvedValue(undefined)
  })

  it("writes a valid Mastra-shaped scene payload into Admin storage with provenance", async () => {
    const prisma = buildPrisma()

    const result = await ingestSceneEmbeddings(prisma as never, payload())

    expect(result).toMatchObject({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        locale: "en",
      },
      scenes: 1,
      dimensions: 1536,
      mastraRunId: "run-1",
    })
    expect(writeSceneEmbeddingPayloadMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "edition-1",
        videoId: "video-1",
        locale: "en",
        scenes: [
          expect.objectContaining({
            sceneIndex: 0,
            sourceText: "Themes: hope.\nContent: An opening scene.",
            embedding: vector(1),
          }),
        ],
        provenance: expect.objectContaining({
          sourceArtifactKey: "42/scene-analysis.json",
          sourceArtifactVersion: "manager-scene-analysis-v1",
          sourceProvider: "manager",
          generationMode: "idempotent",
          mastraRunId: "run-1",
        }),
      }),
    )
  })

  it("returns unchanged and skips writes when idempotent mode sees healthy matching provenance", async () => {
    const prisma = buildPrisma()
    const body = payload()
    const hash = hashFor(body)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingSummary({ source_hashes: [hash] })])

    const result = await ingestSceneEmbeddings(
      prisma as never,
      payload({
        source: {
          ...(body.source as object),
          contentHash: hash,
        },
      }),
    )

    expect(result.status).toBe("unchanged")
    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("repair mode rewrites when provenance matches but stored vectors are unhealthy", async () => {
    const prisma = buildPrisma()
    const body = payload()
    const hash = hashFor(body)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        existingSummary({ healthy_count: 0, source_hashes: [hash] }),
      ])

    const result = await ingestSceneEmbeddings(
      prisma as never,
      payload({
        source: {
          ...(body.source as object),
          contentHash: hash,
        },
        generation: {
          mode: "repair",
          generatedAt: "2026-05-25T00:01:00.000Z",
          mastraRunId: "run-repair",
        },
      }),
    )

    expect(result.status).toBe("repaired")
    expect(writeSceneEmbeddingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it("repair mode leaves healthy matching scene rows unchanged", async () => {
    const prisma = buildPrisma()
    const body = payload()
    const hash = hashFor(body)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingSummary({ source_hashes: [hash] })])

    const result = await ingestSceneEmbeddings(
      prisma as never,
      payload({
        source: {
          ...(body.source as object),
          contentHash: hash,
        },
        generation: {
          mode: "repair",
          generatedAt: "2026-05-25T00:01:00.000Z",
          mastraRunId: "run-repair-healthy",
        },
      }),
    )

    expect(result.status).toBe("unchanged")
    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("model-upgrade mode rewrites healthy scene rows with model-upgraded status", async () => {
    const prisma = buildPrisma()
    const body = payload()
    const hash = hashFor(body)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingSummary({ source_hashes: [hash] })])

    const result = await ingestSceneEmbeddings(
      prisma as never,
      payload({
        source: {
          ...(body.source as object),
          contentHash: hash,
        },
        generation: {
          mode: "model-upgrade",
          generatedAt: "2026-05-25T00:01:00.000Z",
          mastraRunId: "run-model-upgrade",
        },
      }),
    )

    expect(result.status).toBe("model_upgraded")
    expect(writeSceneEmbeddingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it("rejects default idempotent writes when existing scene provenance differs", async () => {
    const prisma = buildPrisma()
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        existingSummary({ source_hashes: ["sha256:old"] }),
      ])

    const result = await ingestSceneEmbeddings(prisma as never, payload())

    expect(result).toMatchObject({
      status: "rejected",
      reason: "existing_scene_differs",
    })
    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects idempotent matches when any existing scene row lacks provenance", async () => {
    const prisma = buildPrisma()
    const body = payload({
      scenes: [
        ...(payload().scenes as object[]),
        {
          sceneIndex: 1,
          startSeconds: 30,
          endSeconds: 60,
          sourceText: "Themes: courage.\nContent: A second scene.",
          description: "Themes: courage.\nContent: A second scene.",
          themes: ["courage"],
          bibleVerses: [],
          demographics: [],
          spiritualContext: [],
          embedding: vector(2),
        },
      ],
    })
    const hash = hashFor(body)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        existingSummary({
          row_count: 2,
          healthy_count: 2,
          source_hash_count: 1,
          source_hashes: [hash],
        }),
      ])

    const result = await ingestSceneEmbeddings(
      prisma as never,
      payload({
        scenes: body.scenes,
        source: {
          ...(body.source as object),
          contentHash: hash,
        },
      }),
    )

    expect(result).toMatchObject({
      status: "rejected",
      reason: "existing_scene_differs",
    })
    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects non-contiguous scene indexes before writing", async () => {
    const prisma = buildPrisma()

    await expect(
      ingestSceneEmbeddings(
        prisma as never,
        payload({
          scenes: [
            {
              ...(payload().scenes[0] as object),
              sceneIndex: 1,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "scene_invalid" })

    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })

  it("rejects dimension drift, source hash drift, incomplete provenance, and mismatched Admin targets before writing", async () => {
    const prisma = buildPrisma()
    await expect(
      ingestSceneEmbeddings(
        prisma as never,
        payload({
          model: {
            name: "openai/text-embedding-3-small",
            dimensions: 768,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })

    await expect(
      ingestSceneEmbeddings(
        prisma as never,
        payload({
          source: {
            ...(payload().source as object),
            contentHash: "sha256:not-the-payload",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "source_hash_mismatch" })

    await expect(
      ingestSceneEmbeddings(
        prisma as never,
        payload({
          source: {
            artifactKey: "42/scene-analysis.json",
            provider: "manager",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "payload_invalid" })

    await expect(
      ingestSceneEmbeddings(
        prisma as never,
        payload({
          target: {
            admin: {
              videoId: "video-1",
              videoEditionId: "edition-1",
              coreId: "wrong-core",
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "target_not_found" })

    prisma.videoEdition.findFirst.mockResolvedValueOnce(null)
    await expect(
      ingestSceneEmbeddings(prisma as never, payload()),
    ).rejects.toMatchObject({ code: "target_not_found" })

    expect(writeSceneEmbeddingPayloadMock).not.toHaveBeenCalled()
  })
})
