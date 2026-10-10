import { afterEach, describe, expect, it, vi } from "vitest"

const { resolveTargetMock, resolveVariantsMock } = vi.hoisted(() => ({
  resolveTargetMock: vi.fn(),
  resolveVariantsMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("./content", () => ({
  resolveWatchLanguagePickerVariants: resolveVariantsMock,
  resolveWatchUnavailableRecoveryTarget: resolveTargetMock,
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
  resolveTargetMock.mockReset()
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
    resolveTargetMock.mockResolvedValue({
      contentTitle: "耶稣受难日直播",
      imageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
    })

    const result = await resolveWatchUnavailableRecovery({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
    })

    expect(reads).toBe(1)
    expect(result).toMatchObject({
      verifiedGap: true,
      contentTitle: "耶稣受难日直播",
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
    expect(resolveTargetMock).toHaveBeenCalledWith(
      "good-friday-live",
      "chinese-simplified",
    )
  })

  it("keeps admitted audio options when Admin has no recovery snapshot", async () => {
    reset = setWatchRouteManifestSourceForTest(async () => manifest)
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
    ])
    resolveTargetMock.mockResolvedValue(null)

    await expect(
      resolveWatchUnavailableRecovery({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      }),
    ).resolves.toMatchObject({
      verifiedGap: true,
      contentTitle: null,
      targetImageUrl: null,
      audioOptions: [
        {
          slug: "english",
          href: "/good-friday-live.html",
        },
      ],
    })
  })

  it("keeps admitted audio options when recovery metadata fails to load", async () => {
    reset = setWatchRouteManifestSourceForTest(async () => manifest)
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
    ])
    resolveTargetMock.mockRejectedValue(new Error("Admin metadata unavailable"))

    await expect(
      resolveWatchUnavailableRecovery({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      }),
    ).resolves.toMatchObject({
      verifiedGap: true,
      contentTitle: null,
      targetImageUrl: null,
      audioOptions: [
        {
          slug: "english",
          href: "/good-friday-live.html",
        },
      ],
    })
  })

  it("keeps recovery metadata when audio options fail to load", async () => {
    reset = setWatchRouteManifestSourceForTest(async () => manifest)
    resolveVariantsMock.mockRejectedValue(
      new Error("Admin variants unavailable"),
    )
    resolveTargetMock.mockResolvedValue({
      contentTitle: "耶稣受难日直播",
      imageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
    })

    await expect(
      resolveWatchUnavailableRecovery({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      }),
    ).resolves.toEqual({
      verifiedGap: true,
      contentTitle: "耶稣受难日直播",
      targetImageUrl:
        "https://imagedelivery.net/account/target/mobileCinematicHigh.jpg",
      audioOptions: [],
    })
  })

  it.each([
    ["a non-HTTPS URL", "http://imagedelivery.net/account/target.jpg"],
    ["an unapproved host", "https://example.com/target.jpg"],
    ["an overlength URL", `https://imagedelivery.net/${"a".repeat(2_100)}`],
  ])("rejects %s for recovery artwork", async (_case, imageUrl) => {
    reset = setWatchRouteManifestSourceForTest(async () => manifest)
    resolveVariantsMock.mockResolvedValue([])
    resolveTargetMock.mockResolvedValue({
      contentTitle: "耶稣受难日直播",
      imageUrl,
    })

    await expect(
      resolveWatchUnavailableRecovery({
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      }),
    ).resolves.toMatchObject({
      verifiedGap: true,
      contentTitle: "耶稣受难日直播",
      targetImageUrl: null,
    })
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
      contentTitle: null,
      targetImageUrl: null,
      audioOptions: [],
    })
    expect(resolveVariantsMock).not.toHaveBeenCalled()
    expect(resolveTargetMock).not.toHaveBeenCalled()
  })
})
