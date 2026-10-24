import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  refreshWatchRouteManifest,
  refreshWatchRouteManifestAfterCoreSync,
  shouldInvalidateWatchRenderDataAfterCoreSync,
  shouldRefreshWatchRouteManifestAfterCoreSync,
} from "./watch-route-manifest-refresh.service"

const generateMock = vi.hoisted(() => vi.fn())
const upsertLatestMock = vi.hoisted(() => vi.fn())

vi.mock("./watch-route-manifest.service", async () => {
  const actual = await vi.importActual<
    typeof import("./watch-route-manifest.service")
  >("./watch-route-manifest.service")
  return {
    ...actual,
    WatchRouteManifestService: vi.fn(() => ({
      generate: generateMock,
    })),
  }
})

vi.mock("./watch-route-manifest-store", () => ({
  WatchRouteManifestStore: vi.fn(() => ({
    upsertLatest: upsertLatestMock,
  })),
}))

const manifest = {
  version: "version-1",
  generatedAt: "2026-05-29T12:00:00.000Z",
  contentSlugs: ["jesus"],
  oneSegmentSlugs: [],
  homepageLocales: ["en"],
  episodePairsByParent: {},
  audioLanguageSlugs: ["english"],
  audioLanguageIndexesByContent: { jesus: [0] },
  audioLanguageIndexesByEpisode: {},
}

describe("watch route manifest refresh", () => {
  beforeEach(() => {
    generateMock.mockReset()
    upsertLatestMock.mockReset()
  })

  it("refreshes the snapshot and emits a manifest webhook after persistence", async () => {
    generateMock.mockResolvedValueOnce(manifest)
    upsertLatestMock.mockResolvedValueOnce({
      version: manifest.version,
      payload: manifest,
      payloadSizeBytes: 128,
    })
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const outcome = await refreshWatchRouteManifest({
      prisma: {} as never,
      reason: "experience.publish",
      emitWebhook,
    })

    expect(outcome).toMatchObject({
      status: "refreshed",
      reason: "experience.publish",
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      payloadSizeBytes: 128,
      counts: {
        contentSlugs: 1,
        homepageLocales: 1,
        audioLanguageSlugs: 1,
        contentAudioLanguagePairs: 1,
        episodeAudioLanguagePairs: 0,
      },
    })
    expect(emitWebhook).toHaveBeenCalledWith({
      model: "watch-route-manifest",
      slug: null,
      locale: null,
    })
  })

  it("swallows generation or persistence failures", async () => {
    generateMock.mockRejectedValueOnce(new Error("db unavailable"))

    const outcome = await refreshWatchRouteManifest({
      prisma: {} as never,
      reason: "experience.update",
      emitWebhook: vi.fn(),
    })

    expect(outcome).toMatchObject({
      status: "failed",
      reason: "experience.update",
      detail: "db unavailable",
    })
  })

  it("detects route-relevant Core sync phases", () => {
    expect(
      shouldRefreshWatchRouteManifestAfterCoreSync([
        { phase: "countries" },
        { phase: "video-images" },
      ]),
    ).toBe(false)
    expect(
      shouldRefreshWatchRouteManifestAfterCoreSync([
        { phase: "countries" },
        { phase: "videos" },
      ]),
    ).toBe(true)
    expect(
      shouldRefreshWatchRouteManifestAfterCoreSync([{ phase: "video-dubs" }]),
    ).toBe(true)
  })

  it("detects changed render-relevant Core sync phases separately from route manifest phases", () => {
    const renderRelevantPhases = [
      "languages",
      "videos",
      "video-images",
      "video-editions",
      "video-subtitles",
      "video-dubs",
      "video-dub-downloads",
    ]

    for (const phase of renderRelevantPhases) {
      expect(
        shouldInvalidateWatchRenderDataAfterCoreSync([
          { phase, created: 0, updated: 1, softDeleted: 0 },
        ]),
      ).toBe(true)
    }

    expect(
      shouldInvalidateWatchRenderDataAfterCoreSync([
        { phase: "video-images", created: 0, updated: 0, softDeleted: 0 },
      ]),
    ).toBe(false)
    expect(
      shouldInvalidateWatchRenderDataAfterCoreSync([
        { phase: "countries", created: 1, updated: 0, softDeleted: 0 },
      ]),
    ).toBe(false)
  })

  it("skips Core sync refresh when no route-relevant phases ran", async () => {
    const emitWebhook = vi.fn()
    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "keywords" }],
      emitWebhook,
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    })
    expect(emitWebhook).not.toHaveBeenCalled()
  })

  it("emits broad video invalidation for render-only Core sync phases without refreshing the manifest", async () => {
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "video-images", created: 1, updated: 0 }],
      emitWebhook,
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    })
    expect(generateMock).not.toHaveBeenCalled()
    expect(upsertLatestMock).not.toHaveBeenCalled()
    expect(emitWebhook).toHaveBeenCalledWith({
      model: "video",
      slug: null,
      locale: null,
    })
  })

  it("emits broad video invalidation for soft-deleted render data", async () => {
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const phases = [
      { phase: "video-subtitles", created: 0, updated: 0, softDeleted: 1 },
    ]

    expect(shouldInvalidateWatchRenderDataAfterCoreSync(phases)).toBe(true)

    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases,
      emitWebhook,
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    })
    expect(generateMock).not.toHaveBeenCalled()
    expect(upsertLatestMock).not.toHaveBeenCalled()
    expect(emitWebhook).toHaveBeenCalledWith({
      model: "video",
      slug: null,
      locale: null,
    })
  })

  it("does not emit broad video invalidation for no-op scheduled Core sync phases", async () => {
    const emitWebhook = vi.fn()

    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases: [
        { phase: "video-images", created: 0, updated: 0, softDeleted: 0 },
      ],
      emitWebhook,
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    })
    expect(emitWebhook).not.toHaveBeenCalled()
  })

  it("refreshes the manifest before broad video invalidation for route-and-render-relevant Core sync phases", async () => {
    generateMock.mockResolvedValueOnce(manifest)
    upsertLatestMock.mockResolvedValueOnce({
      version: manifest.version,
      payload: manifest,
      payloadSizeBytes: 128,
    })
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "video-dubs", updated: 1 }],
      emitWebhook,
    })

    expect(outcome).toMatchObject({
      status: "refreshed",
      reason: "core-sync",
    })
    expect(emitWebhook).toHaveBeenNthCalledWith(1, {
      model: "watch-route-manifest",
      slug: null,
      locale: null,
    })
    expect(emitWebhook).toHaveBeenNthCalledWith(2, {
      model: "video",
      slug: null,
      locale: null,
    })
  })

  it("keeps the Core sync outcome when broad video invalidation throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const emitWebhook = vi
      .fn()
      .mockRejectedValueOnce(new Error("web unavailable"))

    try {
      const outcome = await refreshWatchRouteManifestAfterCoreSync({
        prisma: {} as never,
        phases: [{ phase: "video-images", updated: 1 }],
        emitWebhook,
      })

      expect(outcome).toEqual({
        status: "skipped",
        reason: "no-route-relevant-core-sync-phases",
      })
      expect(emitWebhook).toHaveBeenCalledWith({
        model: "video",
        slug: null,
        locale: null,
      })
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
