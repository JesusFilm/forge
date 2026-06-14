import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  refreshWatchSeoManifest,
  refreshWatchSeoManifestAfterCoreSync,
  shouldRefreshWatchSeoManifestAfterCoreSync,
} from "./watch-seo-manifest-refresh.service"

const generateMock = vi.hoisted(() => vi.fn())
const upsertLatestMock = vi.hoisted(() => vi.fn())

vi.mock("./watch-seo-manifest.service", async () => {
  const actual = await vi.importActual<
    typeof import("./watch-seo-manifest.service")
  >("./watch-seo-manifest.service")
  return {
    ...actual,
    WatchSeoManifestService: vi.fn(() => ({
      generate: generateMock,
    })),
  }
})

vi.mock("./watch-seo-manifest-store", () => ({
  WatchSeoManifestStore: vi.fn(() => ({
    upsertLatest: upsertLatestMock,
  })),
}))

const manifest = {
  version: "version-1",
  generatedAt: "2026-06-12T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "jesus",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  episodeRouteGroups: [],
  skippedHreflangValues: {},
}

describe("watch seo manifest refresh", () => {
  beforeEach(() => {
    generateMock.mockReset()
    upsertLatestMock.mockReset()
  })

  it("refreshes the snapshot and emits a sitemap-manifest webhook", async () => {
    generateMock.mockResolvedValueOnce(manifest)
    upsertLatestMock.mockResolvedValueOnce({
      version: manifest.version,
      payload: manifest,
      payloadSizeBytes: 128,
    })
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const outcome = await refreshWatchSeoManifest({
      prisma: {} as never,
      reason: "operator-script",
      emitWebhook,
    })

    expect(outcome).toMatchObject({
      status: "refreshed",
      reason: "operator-script",
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      payloadSizeBytes: 128,
      counts: {
        videoRouteGroups: 1,
        episodeRouteGroups: 0,
        alternateLinks: 1,
        skippedHreflangValues: 0,
      },
    })
    expect(emitWebhook).toHaveBeenCalledWith({
      model: "watch-seo-manifest",
      slug: null,
      locale: null,
    })
  })

  it("swallows generation or persistence failures", async () => {
    generateMock.mockRejectedValueOnce(new Error("db unavailable"))

    const outcome = await refreshWatchSeoManifest({
      prisma: {} as never,
      reason: "operator-script",
      emitWebhook: vi.fn(),
    })

    expect(outcome).toMatchObject({
      status: "failed",
      reason: "operator-script",
      detail: "db unavailable",
    })
  })

  it("detects seo-relevant Core sync phases", () => {
    expect(
      shouldRefreshWatchSeoManifestAfterCoreSync([
        { phase: "countries" },
        { phase: "video-images" },
      ]),
    ).toBe(false)
    expect(
      shouldRefreshWatchSeoManifestAfterCoreSync([
        { phase: "countries" },
        { phase: "videos" },
      ]),
    ).toBe(true)
    expect(
      shouldRefreshWatchSeoManifestAfterCoreSync([{ phase: "languages" }]),
    ).toBe(true)
    expect(
      shouldRefreshWatchSeoManifestAfterCoreSync([{ phase: "video-dubs" }]),
    ).toBe(true)
  })

  it("skips Core sync refresh when no seo-relevant phases ran", async () => {
    const emitWebhook = vi.fn()
    const outcome = await refreshWatchSeoManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "keywords" }],
      emitWebhook,
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-seo-relevant-core-sync-phases",
    })
    expect(generateMock).not.toHaveBeenCalled()
    expect(upsertLatestMock).not.toHaveBeenCalled()
    expect(emitWebhook).not.toHaveBeenCalled()
  })

  it("refreshes the sitemap manifest after route/language Core sync phases", async () => {
    generateMock.mockResolvedValueOnce(manifest)
    upsertLatestMock.mockResolvedValueOnce({
      version: manifest.version,
      payload: manifest,
      payloadSizeBytes: 128,
    })
    const emitWebhook = vi
      .fn()
      .mockResolvedValue({ status: "sent", httpStatus: 200 })

    const outcome = await refreshWatchSeoManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "video-dubs", updated: 1 }],
      emitWebhook,
    })

    expect(outcome).toMatchObject({
      status: "refreshed",
      reason: "core-sync",
    })
    expect(emitWebhook).toHaveBeenCalledWith({
      model: "watch-seo-manifest",
      slug: null,
      locale: null,
    })
  })
})
