/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { getWatchRouteManifestMock, queryMock } = vi.hoisted(() => ({
  getWatchRouteManifestMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
  },
}))

vi.mock("@/lib/watch-route-manifest", () => ({
  getWatchRouteManifest: getWatchRouteManifestMock,
}))

import {
  resolveWatchLanguageInventory,
  resolveWatchLanguageSwitcherOptions,
} from "./watch-language-inventory"

function inventoryItem({
  availability,
  id,
  parentSlug = null,
  slug,
  watchLanguageSlug,
}: {
  availability: "AUDIO" | "SUBTITLE_ONLY"
  id: string
  parentSlug?: string | null
  slug: string
  watchLanguageSlug: string
}) {
  return {
    id,
    coreId: id,
    slug,
    title: id,
    description: null,
    imageUrl: null,
    imageAlt: null,
    label: "SEGMENT",
    availability,
    watchLanguageSlug,
    parentSlug,
    parentTitle: parentSlug,
    parentOrder: null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

function mockInventory({
  fallbackAudioLanguageSlug = "english",
  languageSlug,
  resolvedLanguageSlug = languageSlug,
}: {
  fallbackAudioLanguageSlug?: string
  languageSlug: string
  resolvedLanguageSlug?: string
}) {
  queryMock
    .mockResolvedValueOnce({
      data: {
        watchLanguageInventory: {
          language: {
            slug: resolvedLanguageSlug,
            bcp47: languageSlug === "russian" ? "ru" : "zh-Hans",
            name: { en: languageSlug },
          },
          counts: {
            audioCollections: 0,
            audioVideos: 1,
            subtitleOnlyVideos: 2,
            total: 3,
          },
          promoted: [],
          audioCollections: [],
          audioVideos: [
            inventoryItem({
              availability: "AUDIO",
              id: "dubbed-video",
              slug: "dubbed-video",
              watchLanguageSlug: languageSlug,
            }),
          ],
          subtitleOnlyVideos: [
            inventoryItem({
              availability: "SUBTITLE_ONLY",
              id: "standalone-subtitle",
              slug: "standalone-subtitle",
              watchLanguageSlug: fallbackAudioLanguageSlug,
            }),
            inventoryItem({
              availability: "SUBTITLE_ONLY",
              id: "episode-subtitle",
              parentSlug: "series",
              slug: "episode-subtitle",
              watchLanguageSlug: fallbackAudioLanguageSlug,
            }),
          ],
        },
      },
    })
    .mockResolvedValueOnce({ data: { languages: [] } })
}

describe("resolveWatchLanguageInventory", () => {
  beforeEach(() => {
    queryMock.mockReset()
    getWatchRouteManifestMock.mockReset()
    getWatchRouteManifestMock.mockResolvedValue(null)
  })

  it.each([
    {
      languageSlug: "chinese-simplified",
      fallbackAudioLanguageSlug: "english",
      expectedStandaloneHref:
        "/standalone-subtitle.html?subtitles=chinese-simplified",
      expectedEpisodeHref:
        "/series.html/episode-subtitle.html?subtitles=chinese-simplified",
    },
    {
      languageSlug: "russian",
      fallbackAudioLanguageSlug: "arabic-modern-standard",
      expectedStandaloneHref:
        "/standalone-subtitle.html/arabic-modern-standard.html?subtitles=russian",
      expectedEpisodeHref:
        "/series.html/episode-subtitle/arabic-modern-standard.html?subtitles=russian",
    },
  ])(
    "carries $languageSlug subtitle intent on subtitle-only fallback-audio routes",
    async ({
      languageSlug,
      fallbackAudioLanguageSlug,
      expectedStandaloneHref,
      expectedEpisodeHref,
    }) => {
      mockInventory({ languageSlug, fallbackAudioLanguageSlug })

      const inventory = await resolveWatchLanguageInventory("en", languageSlug)

      expect(inventory.audioVideos[0]?.href).toBe(
        `/dubbed-video.html/${languageSlug}.html`,
      )
      expect(inventory.subtitleOnlyVideos.map((item) => item.href)).toEqual([
        expectedStandaloneHref,
        expectedEpisodeHref,
      ])
    },
  )

  it("does not build subtitle links from an invalid resolved language slug", async () => {
    mockInventory({
      languageSlug: "russian",
      resolvedLanguageSlug: "Russian!",
    })

    const inventory = await resolveWatchLanguageInventory("en", "russian")

    expect(inventory.audioVideos[0]?.href).toBe(
      "/dubbed-video.html/russian.html",
    )
    expect(inventory.subtitleOnlyVideos.map((item) => item.href)).toEqual([
      null,
      null,
    ])
  })
})

describe("resolveWatchLanguageSwitcherOptions", () => {
  beforeEach(() => {
    queryMock.mockReset()
    getWatchRouteManifestMock.mockReset()
    getWatchRouteManifestMock.mockResolvedValue(null)
  })

  it("returns the language list without fetching the inventory payload", async () => {
    queryMock.mockResolvedValue({
      data: {
        languages: [
          { slug: "russian", bcp47: "ru", name: { en: "Russian" } },
          { slug: "english", bcp47: "en", name: { en: "English" } },
        ],
      },
    })

    const options = await resolveWatchLanguageSwitcherOptions("english")

    // Current language first, then alphabetical — same contract the
    // /{lang}.html/videos switcher renders.
    expect(options.map((option) => option.slug)).toEqual(["english", "russian"])
    // Every call is the paginated `languages` query; nothing asked for
    // watchLanguageInventory, whose payload is every card in a collection.
    for (const call of queryMock.mock.calls) {
      expect(JSON.stringify(call[0]?.variables ?? {})).not.toContain(
        "languageSlug",
      )
    }
  })

  it("degrades to the current language when Admin is unreachable", async () => {
    // The /whats-new page is otherwise data-free and statically rendered.
    // A throwing switcher fetch must not take the whole page down with it.
    queryMock.mockRejectedValue(new Error("ECONNREFUSED"))

    const options = await resolveWatchLanguageSwitcherOptions("english")

    expect(options).toEqual([
      {
        slug: "english",
        languageName: "English",
        nativeName: null,
        bcp47: null,
      },
    ])
  })
})
