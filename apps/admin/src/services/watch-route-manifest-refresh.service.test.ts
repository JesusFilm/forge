import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  refreshWatchRouteManifest,
  refreshWatchRouteManifestAfterCoreSync,
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
  episodePairsByParent: {},
  audioLanguageSlugs: ["english"],
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
        audioLanguageSlugs: 1,
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

  it("skips Core sync refresh when no route-relevant phases ran", async () => {
    const outcome = await refreshWatchRouteManifestAfterCoreSync({
      prisma: {} as never,
      phases: [{ phase: "keywords" }],
    })

    expect(outcome).toEqual({
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    })
  })
})
