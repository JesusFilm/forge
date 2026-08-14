import { afterEach, describe, expect, it, vi } from "vitest"

const { resolveVariantsMock } = vi.hoisted(() => ({
  resolveVariantsMock: vi.fn(),
}))

vi.mock("./content", () => ({
  resolveWatchLanguagePickerVariants: resolveVariantsMock,
}))

import { resolveWatchUnavailableRecovery } from "./watch-unavailable-recovery-actions"
import {
  setWatchRouteManifestSourceForTest,
  type WatchRouteManifest,
} from "./watch-route-manifest"

const manifest: WatchRouteManifest = {
  version: "test",
  generatedAt: "2026-08-13T00:00:00.000Z",
  contentSlugs: ["good-friday-live", "jesus", "perfect-2", "missing"],
  oneSegmentSlugs: ["good-friday-live", "jesus", "perfect-2"],
  episodePairsByParent: {},
  audioLanguageSlugs: [
    "english",
    "mandarin-china",
    "spanish-castilian",
    "russian",
  ],
  audioLanguageIndexesByContent: {
    "good-friday-live": [0, 2],
    jesus: [1],
    "perfect-2": [0],
    missing: [],
  },
  audioLanguageIndexesByEpisode: {},
}

let reset: (() => void) | null = null

afterEach(() => {
  reset?.()
  reset = null
  resolveVariantsMock.mockReset()
})

describe("resolveWatchUnavailableRecovery", () => {
  it("returns only exact admitted audio versions of the unavailable video", async () => {
    let reads = 0
    reset = setWatchRouteManifestSourceForTest(async () => {
      reads += 1
      return manifest
    })
    resolveVariantsMock.mockResolvedValue([
      {
        documentId: "dub-en",
        hls: "https://example.com/en.m3u8",
        published: true,
        language: {
          slug: "english",
          name: "English",
          nativeName: null,
          bcp47: "en",
        },
      },
      {
        documentId: "dub-es",
        hls: "https://example.com/es.m3u8",
        published: true,
        language: {
          slug: "spanish-castilian",
          name: "Español",
          nativeName: "Español",
          bcp47: "es",
        },
      },
      {
        documentId: "dub-zh",
        hls: "https://example.com/zh.m3u8",
        published: true,
        language: {
          slug: "mandarin-china",
          name: "普通话",
          nativeName: "普通话",
          bcp47: "zh",
        },
      },
      {
        documentId: "dub-russian",
        hls: "https://example.com/ru.m3u8",
        published: true,
        language: {
          slug: "russian",
          name: "Русский",
          nativeName: "Русский",
          bcp47: "ru",
        },
      },
    ])

    const result = await resolveWatchUnavailableRecovery({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
      targetImageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
    })

    expect(reads).toBe(1)
    expect(result).toMatchObject({
      verifiedGap: true,
      targetImageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
      audioOptions: [
        {
          slug: "english",
          name: "English",
          nativeName: null,
          bcp47: "en",
          href: "/good-friday-live.html",
        },
        {
          slug: "spanish-castilian",
          name: "Spanish Castilian",
          nativeName: "Español",
          bcp47: "es",
          href: "/good-friday-live.html/spanish-castilian.html",
        },
      ],
    })
    expect(resolveVariantsMock).toHaveBeenCalledWith("good-friday-live")
  })

  it("fails closed when the target gap cannot be proven", async () => {
    reset = setWatchRouteManifestSourceForTest(async () => ({
      ...manifest,
      audioLanguageIndexesByContent: undefined,
    }))

    await expect(
      resolveWatchUnavailableRecovery({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      }),
    ).resolves.toEqual({
      verifiedGap: false,
      targetImageUrl: null,
      audioOptions: [],
    })
    expect(resolveVariantsMock).not.toHaveBeenCalled()
  })
})
