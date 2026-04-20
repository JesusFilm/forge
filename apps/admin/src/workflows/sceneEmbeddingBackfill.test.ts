import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => []),
  }
  return { prisma: mock, syncPrisma: mock }
})

vi.mock("@/services/core-id-mapping.service", () => ({
  loadCoreIdMapping: vi.fn(async () => ({
    generatedAt: "2026-04-19T00:00:00.000Z",
    byCoreId: new Map<string, number>([
      ["core-a", 1],
      ["core-b", 2],
    ]),
  })),
}))

vi.mock("@/services/scene-embedding.service", () => ({
  indexEditionScenes: vi.fn(async () => ({
    editionId: "edition-stub",
    locale: "en",
    scenesIndexed: 2,
    embeddingsWritten: 2,
    scenesSkipped: 0,
    scenesPruned: 0,
    model: "openai/text-embedding-3-small",
    dimensions: 1536,
  })),
}))

const { prisma } = await import("@/db/client")
const { indexEditionScenes } =
  await import("@/services/scene-embedding.service")
const { ManagerArtifactError } =
  await import("@/services/manager-artifacts.service")
const { runSceneEmbeddingBackfill, _internals } =
  await import("./sceneEmbeddingBackfill")

type PrismaStub = { $queryRaw: ReturnType<typeof vi.fn> }

describe("runSceneEmbeddingBackfill", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockClear()
  })

  it("enumerates (video, edition) pairs and indexes each locale per target", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
      { video_id: "v-b", video_edition_id: "e-b", core_id: "core-b" },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en", "es"],
    })

    expect(report.totalTargets).toBe(2)
    expect(report.succeeded).toBe(4) // 2 targets × 2 locales
    expect(report.skipped).toBe(0)
    expect(report.failed).toBe(0)
    expect(indexEditionScenes).toHaveBeenCalledTimes(4)
    expect(indexEditionScenes).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        editionId: "e-a",
        videoId: "v-a",
        coreId: "core-a",
        cmsVideoId: 1,
        locale: "en",
      }),
    )
  })

  it("applies the coreIds filter", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
      { video_id: "v-b", video_edition_id: "e-b", core_id: "core-b" },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      coreIds: ["core-b"],
      locales: ["en"],
    })

    expect(report.totalTargets).toBe(1)
    expect(report.succeeded).toBe(1)
    expect(indexEditionScenes).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b" }),
    )
  })

  it("skips targets whose coreId is absent from the mapping", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
      { video_id: "v-z", video_edition_id: "e-z", core_id: "unmapped-core-z" },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionScenes).toHaveBeenCalledTimes(1)
  })

  it("converts artifact_missing errors to skipped outcomes", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
    ])
    vi.mocked(indexEditionScenes).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "scene-analysis artifact not found for assetId=1",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en"],
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    const skipped = report.outcomes[0]
    expect(skipped?.status).toBe("skipped")
  })

  it("does not demote unrelated errors mentioning 'not found' to skipped", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
    ])
    // A Prisma P2025 "Record not found" error shape — plain Error, not
    // a ManagerArtifactError. Under the old regex this would silently
    // be classified as skipped.
    vi.mocked(indexEditionScenes).mockRejectedValueOnce(
      new Error("Record to update not found."),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en"],
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("records failed outcomes but keeps processing other targets", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
      { video_id: "v-b", video_edition_id: "e-b", core_id: "core-b" },
    ])
    vi.mocked(indexEditionScenes)
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce({
        editionId: "e-b",
        locale: "en",
        scenesIndexed: 1,
        embeddingsWritten: 1,
        scenesSkipped: 0,
        scenesPruned: 0,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      })

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en"],
    })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("treats coreIds: [] as omitted (runs all mapped targets)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
      { video_id: "v-b", video_edition_id: "e-b", core_id: "core-b" },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      coreIds: [],
      locales: ["en"],
    })

    expect(report.totalTargets).toBe(2)
  })

  it("treats locales: [] as omitted (uses default locales)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      { video_id: "v-a", video_edition_id: "e-a", core_id: "core-a" },
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: [],
    })

    // Default locales are en/es/fr, so one target × 3 locales = 3
    expect(report.totalTargets).toBe(1)
    expect(report.outcomes).toHaveLength(3)
  })

  it("returns an empty report when the DB has no editions", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])
    const report = await runSceneEmbeddingBackfill({
      mappingPath: "/tmp/mapping.json",
      locales: ["en"],
    })
    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(indexEditionScenes).not.toHaveBeenCalled()
  })
})

describe("_internals.stepReport", () => {
  it("aggregates mixed outcomes correctly", () => {
    const target = {
      videoId: "v",
      videoEditionId: "e",
      coreId: "core",
      cmsVideoId: 1,
    }
    const report = _internals.stepReport({
      mappingGeneratedAt: "2026-04-19T00:00:00.000Z",
      targets: 2,
      locales: ["en"],
      outcomes: [
        {
          status: "succeeded",
          target,
          locale: "en",
          scenesIndexed: 3,
          embeddingsWritten: 3,
          durationMs: 100,
        },
        {
          status: "failed",
          target,
          locale: "en",
          reason: "boom",
          durationMs: 50,
        },
        {
          status: "skipped",
          target,
          locale: "en",
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
