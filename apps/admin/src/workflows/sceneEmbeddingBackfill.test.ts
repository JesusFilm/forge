import { describe, expect, it, vi, beforeEach } from "vitest"
import type { SceneAnalysisResult } from "@/services/manager-artifacts.service"
import type { BackfillOutcome, BackfillTarget } from "./sceneEmbeddingBackfill"

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

vi.mock("@/services/scene-embedding.service", async (importOriginal) => {
  // importOriginal forwards every export so a future named export
  // (e.g. SceneIndexError, a new helper) doesn't get silently dropped
  // and the consumer-facing error class identity stays live for any
  // future `instanceof SceneIndexError` branching in the workflow.
  const actual =
    await importOriginal<typeof import("@/services/scene-embedding.service")>()
  return {
    ...actual,
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
  }
})

// Stage 2: the workflow loads the scene-analysis artifact at the
// (video, edition) GROUP level (once per group, not per locale).
// Default-resolve to a non-empty artifact so tests that don't care
// about the load path can ignore it. Keep `ManagerArtifactError`
// reachable so the artifact_missing classification path stays
// exercisable without re-deriving the class.
// `satisfies` (per project convention) preserves literal-narrowing on
// nested fields while still enforcing the type contract — useful if a
// downstream test ever wants to read a literal value off the stub.
const STUB_ARTIFACT = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 5,
      chapterTitle: null,
      description: "stub scene",
      themes: [],
      bibleVerses: [],
      demographics: [],
      spiritualContext: [],
    },
  ],
} satisfies SceneAnalysisResult

vi.mock("@/services/manager-artifacts.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/manager-artifacts.service")
    >()
  return {
    ...actual,
    readSceneAnalysisArtifact: vi.fn(async () => STUB_ARTIFACT),
  }
})

const { prisma } = await import("@/db/client")
const { indexEditionScenes } =
  await import("@/services/scene-embedding.service")
const { ManagerArtifactError, readSceneAnalysisArtifact } =
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
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("indexes one target per (edition, locale) triple returned by the enumeration", async () => {
    // The SQL now returns pre-crossed (video, edition, locale) rows;
    // the workflow groups by (video, edition) and fans out per locale.
    // Two editions with two locales each = four targets = four indexer
    // calls.
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

  it("Stage 2: ONE s3.getObject per (video, edition) group across N locales (NOT per locale)", async () => {
    // Five locales for a single (video, edition) group → exactly ONE
    // S3 read at the group level. A regression that re-fetched per
    // locale would surface here as 5 reads — the central efficiency
    // win of feat-116.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
      row("v-a", "e-a", "core-a", "de"),
      row("v-a", "e-a", "core-a", "pt"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(5)
    expect(report.succeeded).toBe(5)
    // ONE artifact load for the whole group.
    expect(readSceneAnalysisArtifact).toHaveBeenCalledTimes(1)
    // The cmsVideoId is passed to readSceneAnalysisArtifact as a string.
    expect(readSceneAnalysisArtifact).toHaveBeenCalledWith("1")
    // Indexer is still called per-locale (5×) — but each call receives
    // the pre-loaded artifact, so the SERVICE skips its own S3 read.
    expect(indexEditionScenes).toHaveBeenCalledTimes(5)
    for (const call of vi.mocked(indexEditionScenes).mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ loadedArtifact: STUB_ARTIFACT }),
      )
    }
  })

  it("Stage 2: TWO groups produce TWO s3.getObject calls (one per group)", async () => {
    // Two distinct (video, edition) groups, each with multiple locales.
    // Stage 2 contract: one S3 read per group, regardless of in-group
    // locale count.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-b", "e-b", "core-b", "fr"),
    ])

    await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(readSceneAnalysisArtifact).toHaveBeenCalledTimes(2)
    const calledWith = vi
      .mocked(readSceneAnalysisArtifact)
      .mock.calls.map((c) => c[0])
      .sort()
    expect(calledWith).toEqual(["1", "2"])
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

  it("Stage 2: a group-level artifact_missing cascades to skipped outcomes for every locale in the group", async () => {
    // A `(video, edition)` group whose artifact is missing fans out
    // skipped outcomes for every locale in the group, with one
    // structured artifact_missing reason. Mirrors Stage 1's per-locale
    // classification but lifted to group level (the natural place
    // Stage 2's load happens).
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "scene-analysis artifact not found for assetId=1",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(3)
    expect(report.failed).toBe(0)
    // Explicit length guard: a regression that emitted ONE group-level
    // outcome instead of cascading per-locale would still satisfy the
    // skipped-status loop body (vacuous on small N), so pin it.
    expect(report.outcomes).toHaveLength(3)
    for (const outcome of report.outcomes) {
      expect(outcome.status).toBe("skipped")
      if (outcome.status === "skipped") {
        expect(outcome.reason).toBe("artifact_missing")
      }
    }
    // Indexer was never invoked because the load short-circuited.
    expect(indexEditionScenes).not.toHaveBeenCalled()
  })

  it("Stage 2: a group-level non-missing artifact error cascades to failed outcomes for every locale in the group", async () => {
    // A `(video, edition)` group whose artifact load fails for ANY
    // reason other than missing → all locales `failed`. Same shape as
    // Stage 1's "non-artifact_missing → failed" rule, lifted to group
    // level.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_invalid",
        "scene-analysis artifact failed schema validation",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(2)
    expect(report.skipped).toBe(0)
    expect(report.outcomes).toHaveLength(2)
    for (const outcome of report.outcomes) {
      expect(outcome.status).toBe("failed")
    }
    expect(indexEditionScenes).not.toHaveBeenCalled()
  })

  it("converts artifact_missing errors thrown by the indexer to skipped outcomes (defense-in-depth)", async () => {
    // With Stage 2's group-level load, this path is theoretically
    // unreachable in production (the workflow always supplies
    // loadedArtifact, so the service never re-reads S3). The catch
    // branch in `stepIndexEditionLocale` still classifies correctly
    // for safety in depth — exercised here via a mocked indexer
    // rejection.
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
    // No groups → no S3 reads.
    expect(readSceneAnalysisArtifact).not.toHaveBeenCalled()
  })

  it("filters exact retry targets after enumeration and preserves group artifact reuse", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-b", "core-a", "en"),
      row("v-b", "e-c", "core-b", "en"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      retryTargets: [
        { coreId: "core-a", videoEditionId: "e-a", locale: "es" },
        { coreId: "core-b", videoEditionId: "e-c", locale: "en" },
      ],
    })

    expect(report.totalTargets).toBe(2)
    expect(report.retrySelection).toEqual({
      requested: 2,
      matched: 2,
      unmatched: 0,
      unmatchedRetryTargets: [],
    })
    expect(readSceneAnalysisArtifact).toHaveBeenCalledTimes(2)
    expect(indexEditionScenes).toHaveBeenCalledTimes(2)
    expect(
      vi
        .mocked(indexEditionScenes)
        .mock.calls.map((call) => ({
          editionId: call[1].editionId,
          locale: call[1].locale,
        }))
        .sort((a, b) =>
          `${a.editionId}:${a.locale}`.localeCompare(
            `${b.editionId}:${b.locale}`,
          ),
        ),
    ).toEqual([
      { editionId: "e-a", locale: "es" },
      { editionId: "e-c", locale: "en" },
    ])
  })

  it("fails closed when exact retry targets no longer match current enumeration", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])

    await expect(
      runSceneEmbeddingBackfill({
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        retryTargets: [
          { coreId: "core-a", videoEditionId: "stale-edition", locale: "en" },
        ],
      }),
    ).rejects.toMatchObject({
      name: "SceneRetrySelectionError",
      retrySelection: {
        requested: 1,
        matched: 0,
        unmatched: 1,
        unmatchedRetryTargets: [
          {
            coreId: "core-a",
            videoEditionId: "stale-edition",
            locale: "en",
          },
        ],
      },
    })
    expect(indexEditionScenes).not.toHaveBeenCalled()
  })
})

// feat-119 PR1 — `missingArtifacts` is a deduped, sorted projection of
// `skipped { reason: "artifact_missing" }` outcomes. The operator pipes
// it into PR2's `pnpm trigger-enrichment --from-report=…` so the upstream
// gaps surfaced by an embed run can be enriched without scrolling the
// full outcome array. These tests pin the dedup-by-assetId, ascending
// sort, exclusion of `failed` outcomes, and the kind: "scene-analysis"
// stamp.
describe("runSceneEmbeddingBackfill — missingArtifacts projection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue(STUB_ARTIFACT)
    vi.mocked(indexEditionScenes).mockResolvedValue({
      editionId: "edition-stub",
      locale: "en",
      scenesIndexed: 1,
      embeddingsWritten: 1,
      scenesSkipped: 0,
      scenesPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })
  })

  it("dedupes by assetId — 3 locales of one missing group produce ONE missingArtifacts entry", async () => {
    // The group cascade emits L skipped outcomes per missing
    // `(video, edition)` for L locales. Operators want the unique set
    // of upstream gaps, not L copies.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_missing",
        "scene-analysis artifact not found for assetId=1",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.skipped).toBe(3)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]).toEqual({
      assetId: 1,
      coreId: "core-a",
      kind: "scene-analysis",
    })
  })

  it("sorts ascending by assetId — two distinct missing groups yield two entries in numeric order", async () => {
    // mapping: core-a → 1, core-b → 2. Reverse the row order so an
    // unsorted projection would yield [2, 1] — assert the sort.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-b", "e-b", "core-b", "en"),
      row("v-a", "e-a", "core-a", "en"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValue(
      new ManagerArtifactError(
        "artifact_missing",
        "scene-analysis artifact not found",
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.missingArtifacts.map((m) => m.assetId)).toEqual([1, 2])
    expect(report.missingArtifacts[0]?.coreId).toBe("core-a")
    expect(report.missingArtifacts[1]?.coreId).toBe("core-b")
  })

  it("returns an empty array when every target succeeds (NOT undefined)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
    ])

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBe(1)
    expect(report.missingArtifacts).toEqual([])
    // Defensive — undefined would also be a regression because
    // downstream JSON consumers would have to nil-check.
    expect(Array.isArray(report.missingArtifacts)).toBe(true)
  })

  it("excludes failed outcomes — only `skipped { artifact_missing }` enters the list", async () => {
    // Two distinct groups: core-a's group has an `artifact_invalid`
    // error (cascades as `failed`); core-b's group is MISSING
    // (cascades as `skipped`). The list must contain only the missing
    // entry — a failed outcome is a real failure, not an upstream gap.
    //
    // Use mockImplementation keyed on the assetId argument so this
    // test does NOT depend on group invocation order. If the workflow
    // ever switches to a parallel cascade (Promise.allSettled across
    // groups), call ordering becomes nondeterministic but the
    // assertions below keep working.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockImplementation(
      async (assetId: string) => {
        if (assetId === "1") {
          throw new ManagerArtifactError(
            "artifact_invalid",
            "scene-analysis artifact failed schema validation",
          )
        }
        if (assetId === "2") {
          throw new ManagerArtifactError(
            "artifact_missing",
            "scene-analysis artifact not found",
          )
        }
        return STUB_ARTIFACT
      },
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(1)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]?.assetId).toBe(2)
    expect(report.missingArtifacts[0]?.coreId).toBe("core-b")
  })

  it("mixed run: one missing group + one present group → one missingArtifacts entry, succeeded > 0", async () => {
    // Confirms the projection coexists with the success path. The
    // present group's outcomes are `succeeded` and contribute nothing
    // to missingArtifacts. assetId-keyed mock to decouple from group
    // invocation order.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockImplementation(
      async (assetId: string) => {
        if (assetId === "2") {
          throw new ManagerArtifactError(
            "artifact_missing",
            "scene-analysis artifact not found",
          )
        }
        return STUB_ARTIFACT
      },
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.succeeded).toBeGreaterThan(0)
    expect(report.skipped).toBeGreaterThan(0)
    expect(report.missingArtifacts).toHaveLength(1)
    expect(report.missingArtifacts[0]?.assetId).toBe(2)
    expect(report.missingArtifacts[0]?.coreId).toBe("core-b")
  })
})

describe("runSceneEmbeddingBackfill — bounded parallelism", () => {
  beforeEach(() => {
    // Restore any `vi.spyOn(_internals, ...)` from a prior test so
    // the next test sees the real `stepIndexEditionLocale`. Module-
    // level `vi.mock` factories (e.g. `indexEditionScenes`,
    // `readSceneAnalysisArtifact`) are unaffected by `restoreAllMocks`
    // — they survive.
    vi.restoreAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("isolates a per-target indexer error: errors caught inside stepIndexEditionLocale → outcome stays `failed`, siblings continue", async () => {
    // Indexer-level failure path: `indexEditionScenes` rejects, the
    // step's internal try/catch converts it to a typed `failed`
    // outcome, the workflow records it without aborting siblings.
    // This test exercises the per-target catch branch — separate from
    // the `Promise.allSettled` defensive branch (covered below).
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
    expect(indexEditionScenes).toHaveBeenCalledTimes(3)
  })

  it("uses Promise.allSettled (not Promise.all) — a step-level rejection is recorded as a synthetic failed outcome (cascaded to every locale in the affected group)", async () => {
    // Distinguishes `Promise.allSettled` from `Promise.all`. Spy on
    // `_internals.stepIndexEditionLocale` so the rejection bypasses
    // the step's internal try/catch and reaches the workflow's
    // `Promise.allSettled` boundary directly. Under `Promise.all`,
    // the workflow body's `await` would throw and `stepReport` would
    // never run; under `Promise.allSettled`, the workflow synthesizes
    // failed outcomes (one per locale in the cascaded group) and the
    // report comes back normally.
    //
    // Stage 2: each row below is a distinct (video, edition) group
    // (e-a, e-b, e-c) with a single locale, so a step-level throw on
    // core-b's group cascades to a single failed outcome.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    // Use the real BackfillTarget / BackfillOutcome types so a future
    // field added to BackfillOutcome.succeeded surfaces as a compile
    // error here instead of being silently absent under `as never`.
    const okOutcome = (
      target: BackfillTarget,
      durationMs: number,
    ): BackfillOutcome => ({
      status: "succeeded",
      target,
      locale: target.locale,
      scenesIndexed: 1,
      embeddingsWritten: 1,
      durationMs,
    })

    vi.spyOn(_internals, "stepIndexEditionLocale").mockImplementation(
      async (target) => {
        if (target.coreId === "core-b") {
          // Genuine rejection that escapes the step boundary.
          throw new Error("step plumbing fault")
        }
        return okOutcome(target, 5)
      },
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.totalTargets).toBe(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.skipped).toBe(0)
    const failedOutcome = report.outcomes.find((o) => o.status === "failed")
    expect(failedOutcome).toBeDefined()
    if (failedOutcome?.status === "failed") {
      expect(failedOutcome.target.coreId).toBe("core-b")
      expect(failedOutcome.reason).toBe("step plumbing fault")
      // Synthetic outcome carries real elapsed batch time, not 0 —
      // dashboards built on durationMs aren't polluted by the
      // defensive branch firing.
      expect(failedOutcome.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it("caps concurrent in-flight (video, edition) groups at SCENE_EMBEDDING_CONCURRENCY (and uses parallelism, not sequential)", async () => {
    // Asserts BOTH that the concurrency cap is honored (≤ 2
    // in-flight) AND that real parallelism is used (max in-flight
    // === N). A regression to sequential `for…of` would yield
    // `observedMaxInFlight === 1` and fail the second assertion.
    //
    // Stage 2: each row is a distinct (video, edition) group, so the
    // group-level pLimit cap is observable as in-flight indexer
    // calls — one indexer call active per group at any given moment
    // (per-locale work inside a group is sequential and there's only
    // one locale per group in this fixture).
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-c", "e-c", "core-a", "es"),
    ])

    let inFlight = 0
    let observedMaxInFlight = 0

    vi.mocked(indexEditionScenes).mockImplementation(async (_prisma, args) => {
      inFlight += 1
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      // Yield to the event loop so concurrent invocations can
      // observably overlap. 25 ms is plenty for parallel start
      // detection without leaning on wall-clock comparison
      // assertions.
      await new Promise((resolve) => setTimeout(resolve, 25))
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

    // Mocked env to SCENE_EMBEDDING_CONCURRENCY=2.
    expect(observedMaxInFlight).toBe(2)
    expect(indexEditionScenes).toHaveBeenCalledTimes(3)
  })

  it("Stage 2: per-locale work inside a group runs sequentially — multi-locale groups do NOT multiply concurrent indexer calls beyond the cap", async () => {
    // The cap variant above gives every group exactly ONE locale, so
    // observedMaxInFlight only proves the per-GROUP cap. This variant
    // gives each of the 2 groups THREE locales (6 total targets at
    // concurrency=2). If processGroup ever fanned out per-locale work
    // in parallel (Promise.all over group.targets.map), maxInFlight
    // would jump to 6 (or 4+ if partially batched). Sequential per-
    // locale inside the group keeps it pinned at SCENE_EMBEDDING_CONCURRENCY=2.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
      row("v-b", "e-b", "core-b", "en"),
      row("v-b", "e-b", "core-b", "es"),
      row("v-b", "e-b", "core-b", "fr"),
    ])

    let inFlight = 0
    let observedMaxInFlight = 0

    vi.mocked(indexEditionScenes).mockImplementation(async (_prisma, args) => {
      inFlight += 1
      observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 15))
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

    // 2 groups × 3 locales = 6 total indexer calls; cap stays at 2.
    expect(indexEditionScenes).toHaveBeenCalledTimes(6)
    expect(observedMaxInFlight).toBe(2)
  })
})

describe("runSceneEmbeddingBackfill — start log", () => {
  beforeEach(() => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockClear()
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("emits a structured start log with workflow, event, mappingGeneratedAt, totalTargets, groupCount, concurrency, localeFilter", async () => {
    // Operators rely on log-grep dashboards (per CLAUDE.md operational
    // runbook). Pin the start-log shape so a future refactor can't
    // silently drop a field. `groupCount` is the Stage 2 addition that
    // surfaces the artifact-fetch fan-in; assert it's present and
    // matches the actual group count.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-b", "e-b", "core-b", "en"),
    ])

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    let calls: unknown[][] = []
    try {
      await runSceneEmbeddingBackfill({
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        locales: ["en", "es"],
      })
      // Snapshot calls BEFORE mockRestore — restore clears mock.calls.
      calls = logSpy.mock.calls
    } finally {
      logSpy.mockRestore()
    }

    const startPayload = calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .find(
        (p): p is Record<string, unknown> =>
          p != null &&
          p.event === "start" &&
          p.workflow === "scene-embedding-backfill",
      )

    expect(startPayload).toBeDefined()
    expect(startPayload).toMatchObject({
      workflow: "scene-embedding-backfill",
      event: "start",
      mappingGeneratedAt: "2026-04-19T00:00:00.000Z",
      totalTargets: 3,
      groupCount: 2,
      concurrency: 2,
      localeFilter: ["en", "es"],
    })
  })
})

describe("groupTargetsByVideoEdition", () => {
  it("groups (video, edition, locale) targets by (video, edition) preserving target order", () => {
    const targets = [
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        locale: "en",
      },
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        locale: "es",
      },
      {
        videoId: "v-b",
        videoEditionId: "e-b",
        coreId: "core-b",
        cmsVideoId: 2,
        locale: "en",
      },
      {
        videoId: "v-a",
        videoEditionId: "e-a",
        coreId: "core-a",
        cmsVideoId: 1,
        locale: "fr",
      },
    ]
    const groups = _internals.groupTargetsByVideoEdition(targets)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.cmsVideoId).toBe(1)
    expect(groups[0]?.targets.map((t) => t.locale)).toEqual(["en", "es", "fr"])
    expect(groups[1]?.cmsVideoId).toBe(2)
    expect(groups[1]?.targets.map((t) => t.locale)).toEqual(["en"])
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
      retrySelection: null,
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
          failureCategory: "other",
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

describe("runSceneEmbeddingBackfill — groupedFailures projection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    vi.mocked(indexEditionScenes).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockReset()
    vi.mocked(readSceneAnalysisArtifact).mockResolvedValue(STUB_ARTIFACT)
  })

  it("collapses repeated artifact read failures by asset, edition, and category", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("v-a", "e-a", "core-a", "en"),
      row("v-a", "e-a", "core-a", "es"),
      row("v-a", "e-a", "core-a", "fr"),
    ])
    vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(
      new ManagerArtifactError(
        "artifact_read_failed",
        "failed to read scene-analysis artifact for assetId=1: getaddrinfo ENOTFOUND t3.storageapi.dev",
        Object.assign(new Error("getaddrinfo ENOTFOUND t3.storageapi.dev"), {
          code: "ENOTFOUND",
        }),
      ),
    )

    const report = await runSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(report.failed).toBe(3)
    expect(report.groupedFailures).toEqual([
      expect.objectContaining({
        assetId: 1,
        coreId: "core-a",
        videoEditionId: "e-a",
        category: "dns_failed",
        count: 3,
        sampleLocales: ["en", "es", "fr"],
      }),
    ])
    expect(report.missingArtifacts).toEqual([])
  })

  it("classifies Prisma and provider validation failures", () => {
    expect(
      _internals.classifySceneFailure(
        new Error("PrismaClientKnownRequestError(P2028) during write"),
      ),
    ).toBe("prisma_transaction")
    expect(
      _internals.classifySceneFailure(
        new Error("Embedding response validation failed"),
      ),
    ).toBe("provider_validation")
  })

  it("classifies storage transport categories distinctly", () => {
    expect(
      _internals.classifySceneFailure(
        Object.assign(new Error("getaddrinfo ENOTFOUND t3.storageapi.dev"), {
          code: "ENOTFOUND",
        }),
      ),
    ).toBe("dns_failed")
    expect(
      _internals.classifySceneFailure(
        Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
      ),
    ).toBe("timeout")
    expect(
      _internals.classifySceneFailure(
        Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
      ),
    ).toBe("access_denied")
    expect(
      _internals.classifySceneFailure(
        Object.assign(new Error("NoSuchBucket"), { name: "NoSuchBucket" }),
      ),
    ).toBe("bucket_not_found")
  })
})
