import { describe, expect, it, vi, beforeEach } from "vitest"
import { resolveScope } from "./orchestrator"

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
})
