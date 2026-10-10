import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveScope } from "./orchestrator"

vi.mock("../watch-catalog-publication", async (original) => ({
  ...(await original<typeof import("../watch-catalog-publication")>()),
  requestWatchCatalogPublication: vi.fn().mockResolvedValue(undefined),
}))

const refreshAfterCoreSyncMock = vi.hoisted(() => vi.fn())
const refreshSeoAfterCoreSyncMock = vi.hoisted(() => vi.fn())

vi.mock("./lock", () => ({
  acquireSyncLock: vi.fn(),
  refreshSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
}))

vi.mock("../watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifestAfterCoreSync: refreshAfterCoreSyncMock,
}))

vi.mock("../watch-seo-manifest-refresh.service", () => ({
  refreshWatchSeoManifestAfterCoreSync: refreshSeoAfterCoreSyncMock,
}))

vi.mock("./watermark", () => ({
  getWatermark: vi.fn().mockResolvedValue(null),
  advanceWatermark: vi.fn().mockResolvedValue(undefined),
  updateStatsOnly: vi.fn().mockResolvedValue(undefined),
  getAllWatermarks: vi.fn().mockResolvedValue([]),
}))

vi.mock("./phases/sync-languages", () => ({
  syncLanguages: vi.fn(),
}))
vi.mock("./phases/sync-countries", () => ({
  syncCountries: vi.fn(),
}))
vi.mock("./phases/sync-keywords", () => ({
  syncKeywords: vi.fn(),
}))
vi.mock("./phases/sync-video-origins", () => ({
  syncVideoOrigins: vi.fn(),
}))
vi.mock("./phases/sync-videos", () => ({
  syncVideos: vi.fn(),
}))
vi.mock("./phases/sync-video-images", () => ({
  syncVideoImages: vi.fn(),
}))
vi.mock("./phases/sync-video-editions", () => ({
  syncVideoEditions: vi.fn(),
}))
vi.mock("./phases/sync-video-subtitles", () => ({
  syncVideoSubtitles: vi.fn(),
}))
vi.mock("./phases/sync-dubs", () => ({
  syncDubs: vi.fn(),
}))
vi.mock("./phases/sync-dub-downloads", () => ({
  syncDubDownloads: vi.fn(),
}))

describe("resolveScope", () => {
  it("returns all phases for undefined input", () => {
    expect(resolveScope()).toEqual([
      "languages",
      "countries",
      "keywords",
      "video-origins",
      "videos",
      "video-images",
      "video-editions",
      "video-subtitles",
      "video-dubs",
      "video-dub-downloads",
    ])
  })

  it("returns all phases for string 'all'", () => {
    expect(resolveScope("all")).toEqual([
      "languages",
      "countries",
      "keywords",
      "video-origins",
      "videos",
      "video-images",
      "video-editions",
      "video-subtitles",
      "video-dubs",
      "video-dub-downloads",
    ])
  })

  it("returns all phases for array ['all'] (GraphQL mutation path)", () => {
    expect(resolveScope(["all"])).toEqual([
      "languages",
      "countries",
      "keywords",
      "video-origins",
      "videos",
      "video-images",
      "video-editions",
      "video-subtitles",
      "video-dubs",
      "video-dub-downloads",
    ])
  })

  it("returns single phase", () => {
    expect(resolveScope("languages")).toEqual(["languages"])
  })

  it("preserves canonical order regardless of input order", () => {
    expect(resolveScope(["videos", "languages", "keywords"])).toEqual([
      "languages",
      "keywords",
      "videos",
    ])
  })

  it("filters out invalid phases", () => {
    expect(resolveScope(["languages", "invalid-phase"])).toEqual(["languages"])
  })

  it("returns empty array for entirely invalid input", () => {
    expect(resolveScope(["nope"])).toEqual([])
  })
})

describe("runSync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refreshAfterCoreSyncMock.mockResolvedValue({ status: "skipped" })
    refreshSeoAfterCoreSyncMock.mockResolvedValue({ status: "skipped" })
  })

  it("returns skipped when lock is held", async () => {
    const { acquireSyncLock } = await import("./lock")
    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)

    const { runSync } = await import("./orchestrator")
    const mockPrisma = {} as Parameters<typeof runSync>[0]

    const result = await runSync(mockPrisma)
    expect(result.skipped).toBe(true)
  })

  it("advances watermark when phase has zero errors", async () => {
    const { acquireSyncLock, refreshSyncLock, releaseSyncLock } =
      await import("./lock")
    const { advanceWatermark, getWatermark } = await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      created: 5,
      updated: 0,
      softDeleted: 0,
      errors: 0,
    })

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    await runSync(mockPrisma, { scope: "languages" })

    expect(advanceWatermark).toHaveBeenCalled()
    expect(releaseSyncLock).toHaveBeenCalledWith(
      mockPrisma,
      expect.stringMatching(/^sync-\d+$/),
    )
    expect(refreshAfterCoreSyncMock).toHaveBeenCalledWith({
      prisma: mockPrisma,
      phases: [
        expect.objectContaining({
          phase: "languages",
          created: 5,
          errors: 0,
        }),
      ],
    })
    expect(refreshSeoAfterCoreSyncMock).toHaveBeenCalledWith({
      prisma: mockPrisma,
      phases: [
        expect.objectContaining({
          phase: "languages",
          created: 5,
          errors: 0,
        }),
      ],
    })
  })

  it("does NOT advance watermark when phase has errors", async () => {
    const { acquireSyncLock, refreshSyncLock, releaseSyncLock } =
      await import("./lock")
    const { advanceWatermark, updateStatsOnly, getWatermark } =
      await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      created: 3,
      updated: 0,
      softDeleted: 0,
      errors: 2,
    })

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    await runSync(mockPrisma, { scope: "languages" })

    expect(advanceWatermark).not.toHaveBeenCalled()
    expect(updateStatsOnly).toHaveBeenCalled()
  })

  it("releases lock even when phase throws", async () => {
    const { acquireSyncLock, refreshSyncLock, releaseSyncLock } =
      await import("./lock")
    const { getWatermark } = await import("./watermark")
    const { syncLanguages } = await import("./phases/sync-languages")

    ;(acquireSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(releaseSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    )
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncLanguages as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Core API down"),
    )

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSync>[0]

    const { runSync } = await import("./orchestrator")
    const result = await runSync(mockPrisma, { scope: "languages" })

    expect(releaseSyncLock).toHaveBeenCalledWith(
      mockPrisma,
      expect.stringMatching(/^sync-\d+$/),
    )
    expect(result.phases[0].errors).toBe(1)
  })

  it("reports throttled phase progress while a phase runs", async () => {
    const { refreshSyncLock } = await import("./lock")
    const { getWatermark, advanceWatermark } = await import("./watermark")
    const { syncVideos } = await import("./phases/sync-videos")

    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(getWatermark as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(syncVideos as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async ({ progress }) => {
        progress.setTotal(50)
        progress.increment(25)
        return {
          created: 0,
          updated: 25,
          softDeleted: 0,
          errors: 0,
        }
      },
    )

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof import("./orchestrator").runSyncPhase>[0]
    const onProgress = vi.fn()

    const { runSyncPhase } = await import("./orchestrator")
    await runSyncPhase(
      mockPrisma,
      {
        runId: "sync-run-1",
        incremental: true,
        phasesToRun: ["videos"],
        startedAtMs: Date.now(),
      },
      "videos",
      { onProgress },
    )

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "videos",
        completed: 0,
        total: 50,
      }),
    )
    expect(advanceWatermark).toHaveBeenCalled()
  })

  it("logs Core GraphQL error details when a phase throws", async () => {
    const { refreshSyncLock } = await import("./lock")
    const { syncVideos } = await import("./phases/sync-videos")
    const { CoreGraphQLError } = await import("./core-client")

    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    ;(syncVideos as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new CoreGraphQLError([
        {
          message: "Not authorized to resolve Video.restrictViewPlatforms",
          path: ["videos", 0, "restrictViewPlatforms"],
          extensions: { code: "FORBIDDEN" },
        },
      ]),
    )
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)

    const { runSyncPhase } = await import("./orchestrator")
    await runSyncPhase(
      mockPrismaForPhase(),
      {
        runId: "sync-run-1",
        incremental: true,
        phasesToRun: ["videos"],
        startedAtMs: Date.now(),
      },
      "videos",
    )

    const phaseError = errorSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === "core-sync.phase.error")
    expect(phaseError).toMatchObject({
      phase: "videos",
      error: expect.stringContaining(
        "Not authorized to resolve Video.restrictViewPlatforms",
      ),
      coreErrors: [
        {
          message: "Not authorized to resolve Video.restrictViewPlatforms",
          path: ["videos", 0, "restrictViewPlatforms"],
          code: "FORBIDDEN",
        },
      ],
    })
    errorSpy.mockRestore()
  })
})

function mockPrismaForPhase() {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof import("./orchestrator").runSyncPhase>[0]
}

describe("runSyncPhase parent watermark cap", () => {
  const VIDEOS_STUCK_AT = "2026-08-03T11:02:48.000Z"
  const DUBS_AT = "2026-09-28T07:00:00.000Z"

  beforeEach(async () => {
    vi.clearAllMocks()
    const { refreshSyncLock } = await import("./lock")
    ;(refreshSyncLock as ReturnType<typeof vi.fn>).mockResolvedValue(true)
  })

  async function runClean(
    phase: "video-dubs" | "video-images" | "video-dub-downloads" | "languages",
    watermarks: Partial<Record<string, string | null>>,
  ) {
    const watermark = await import("./watermark")
    ;(watermark.getWatermark as ReturnType<typeof vi.fn>).mockImplementation(
      async (_prisma: unknown, p: string) => watermarks[p] ?? null,
    )
    const phases = {
      "video-dubs": (await import("./phases/sync-dubs")).syncDubs,
      "video-images": (await import("./phases/sync-video-images"))
        .syncVideoImages,
      "video-dub-downloads": (await import("./phases/sync-dub-downloads"))
        .syncDubDownloads,
      languages: (await import("./phases/sync-languages")).syncLanguages,
    }
    ;(phases[phase] as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      created: 0,
      updated: 4,
      softDeleted: 0,
      errors: 0,
    })

    const { runSyncPhase } = await import("./orchestrator")
    await runSyncPhase(
      mockPrismaForPhase(),
      {
        runId: "sync-run-1",
        incremental: true,
        phasesToRun: [phase],
        startedAtMs: Date.now(),
      },
      phase,
    )
    return watermark
  }

  it("never advances a video-dependent phase past a stuck videos watermark", async () => {
    // The incident: videos failed every night from 2026-08-10, while
    // video-dubs kept succeeding and advancing, so dubs of videos published
    // in that window were skipped (missing parent) and never re-read.
    const { advanceWatermark } = await runClean("video-dubs", {
      videos: VIDEOS_STUCK_AT,
      "video-dubs": DUBS_AT,
    })

    expect(advanceWatermark).toHaveBeenCalledWith(
      expect.anything(),
      "video-dubs",
      VIDEOS_STUCK_AT,
      expect.objectContaining({ errors: 0 }),
    )
  })

  it("caps video-images at the videos watermark too", async () => {
    const { advanceWatermark } = await runClean("video-images", {
      videos: VIDEOS_STUCK_AT,
    })

    expect(advanceWatermark).toHaveBeenCalledWith(
      expect.anything(),
      "video-images",
      VIDEOS_STUCK_AT,
      expect.anything(),
    )
  })

  it("caps video-dub-downloads at the video-dubs watermark", async () => {
    const { advanceWatermark } = await runClean("video-dub-downloads", {
      videos: "2999-01-01T00:00:00.000Z",
      "video-dubs": VIDEOS_STUCK_AT,
    })

    expect(advanceWatermark).toHaveBeenCalledWith(
      expect.anything(),
      "video-dub-downloads",
      VIDEOS_STUCK_AT,
      expect.anything(),
    )
  })

  it("advances to its own fetch-start time when the parent is ahead", async () => {
    const before = Date.now()
    const { advanceWatermark } = await runClean("video-dubs", {
      videos: "2999-01-01T00:00:00.000Z",
    })

    const advancedTo = (advanceWatermark as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as string
    expect(Date.parse(advancedTo)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(advancedTo)).toBeLessThanOrEqual(Date.now())
  })

  it("holds a dependent watermark when its parent has never synced", async () => {
    const { advanceWatermark, updateStatsOnly } = await runClean("video-dubs", {
      videos: null,
    })

    expect(advanceWatermark).not.toHaveBeenCalled()
    expect(updateStatsOnly).toHaveBeenCalledWith(
      expect.anything(),
      "video-dubs",
      expect.objectContaining({ errors: 0 }),
    )
  })

  it("leaves independent phases uncapped", async () => {
    const { advanceWatermark, getWatermark } = await runClean("languages", {
      videos: VIDEOS_STUCK_AT,
    })

    expect(getWatermark).not.toHaveBeenCalledWith(expect.anything(), "videos")
    const advancedTo = (advanceWatermark as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as string
    expect(advancedTo).not.toBe(VIDEOS_STUCK_AT)
  })
})
