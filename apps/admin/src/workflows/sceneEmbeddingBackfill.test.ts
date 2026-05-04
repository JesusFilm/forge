import { describe, expect, it, vi, beforeEach } from "vitest"

// Concurrency must be set BEFORE the workflow is imported below so the
// p-limit instance reads the override. vi.mock hoists ahead of the
// dynamic imports.
vi.mock("@/config/env", () => ({
  env: {
    SCENE_EMBEDDING_CONCURRENCY: 2,
  },
}))

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

describe("runSceneEmbeddingBackfill", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockClear()
  })

  it("indexes one target per (edition, locale) triple returned by the enumeration", async () => {
    // The SQL now returns pre-crossed (video, edition, locale) rows;
    // the workflow just iterates. Two editions with two locales each
    // = four rows = four indexer calls.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-b", "e-b", "core-b", "es"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(4)
    expect(report.succeeded).toBe(4)
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

  it("produces one target per (edition, locale) pair for multi-locale editions", async () => {
    // A single edition surfaced in three locales (primary, subtitle,
    // dub) should produce three distinct targets, not one.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(indexEditionScenes).toHaveBeenCalledTimes(3)
    const locales = vi
      .mocked(indexEditionScenes)
      .mock.calls.map((c) => (c[1] as { locale: string }).locale)
      .sort()
    expect(locales).toEqual(["en", "es", "fr"])
  })

  it("applies the coreIds filter", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-b"],
    })

    expect(report.totalTargets).toBe(1)
    expect(report.succeeded).toBe(1)
    expect(indexEditionScenes).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b" }),
    )
  })

  it("locales filter is a strict inclusion list — no hardcoded default applies", async () => {
    // Confirm the post-prototype behavior: if the SQL returns a row
    // for (core-a, es) but the caller's filter is ["en"], the target
    // is dropped. The previous `DEFAULT_LOCALES = ['en', 'es', 'fr']`
    // fallback is gone.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      locales: ["en"],
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionScenes).toHaveBeenCalledTimes(1)
    expect(indexEditionScenes).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ coreId: "core-b", locale: "en" }),
    )
  })

  it("skips targets whose coreId is absent from the mapping", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-z", "e-z", "unmapped-core-z", "en"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(1)
    expect(indexEditionScenes).toHaveBeenCalledTimes(1)
  })

  it("converts artifact_missing errors to skipped outcomes", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionScenes).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "scene-analysis artifact not found for assetId=1",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    const skipped = report.outcomes[0]
    expect(skipped?.status).toBe("skipped")
  })

  it("does not demote unrelated errors mentioning 'not found' to skipped", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(indexEditionScenes).mockRejectedValueOnce(
      new Error("Record to update not found."),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("records failed outcomes but keeps processing other targets", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
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

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
    })

    expect(report.totalTargets).toBe(2)
  })

  it("treats locales: [] as omitted (no filter applied)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "fr"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      locales: [],
    })

    expect(report.totalTargets).toBe(1)
    expect(report.localeFilter).toBeNull()
  })

  it("returns an empty report when the DB has no editions", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])
    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })
    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(indexEditionScenes).not.toHaveBeenCalled()
  })
})

describe("runSceneEmbeddingBackfill — bounded parallelism", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockClear()
  })

  it("isolates one rejecting target from siblings (no Promise.all regression)", async () => {
    // Three targets: middle one rejects, the other two resolve. With
    // p-limit + Promise.allSettled, the rejection must NOT abort the
    // batch — the documented contract per
    // docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    const ok = (locale: string) => ({
      editionId: `e-${locale}`,
      locale,
      scenesIndexed: 1,
      embeddingsWritten: 1,
      scenesSkipped: 0,
      scenesPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })

    vi.mocked(indexEditionScenes)
      .mockResolvedValueOnce(ok("en"))
      .mockRejectedValueOnce(new Error("kaboom"))
      .mockResolvedValueOnce(ok("es"))

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    // Indexer was invoked for every target — none aborted before
    // reaching the service.
    expect(indexEditionScenes).toHaveBeenCalledTimes(3)
  })

  it("caps concurrent in-flight indexer calls at SCENE_EMBEDDING_CONCURRENCY", async () => {
    // With concurrency=2 and three targets each delayed >=20ms, the
    // third target must NOT start before the first or second resolves.
    // Asserts the bounded-parallelism behavioral guarantee.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    let inFlight = 0
    let observedMaxInFlight = 0
    const startTimes: number[] = []
    const endTimes: number[] = []
    const TARGET_MS = 25

    vi.mocked(indexEditionScenes).mockImplementation(async (_prisma, args) => {
      inFlight += 1
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      startTimes.push(Date.now())
      await new Promise((resolve) => setTimeout(resolve, TARGET_MS))
      endTimes.push(Date.now())
      inFlight -= 1
      return {
        editionId: args.editionId,
        locale: args.locale,
        scenesIndexed: 1,
        embeddingsWritten: 1,
        scenesSkipped: 0,
        scenesPruned: 0,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      }
    })

    await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    // Concurrency cap held: at no point did more than 2 targets run
    // simultaneously. (Mocked env to SCENE_EMBEDDING_CONCURRENCY=2.)
    expect(observedMaxInFlight).toBeLessThanOrEqual(2)
    // The third target started AFTER one of the first two finished.
    // Using the earliest end-time among the first batch, with a small
    // epsilon for scheduler jitter on slow CI hosts.
    expect(startTimes.length).toBe(3)
    expect(endTimes.length).toBe(3)
    const earliestEnd = Math.min(endTimes[0]!, endTimes[1]!)
    expect(startTimes[2]!).toBeGreaterThanOrEqual(earliestEnd - 5)
  })
})

describe("_internals.stepReport", () => {
  it("aggregates mixed outcomes correctly", () => {
    const target = {
      videoId: "v",
      videoEditionId: "e",
      coreId: "core",
      cmsVideoId: 1,
      locale: "en",
    }
    const report = _internals.stepReport({
      mappingGeneratedAt: "2026-04-19T00:00:00.000Z",
      targets: 3,
      localeFilter: null,
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
