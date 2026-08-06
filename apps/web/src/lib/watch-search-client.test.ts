import { beforeEach, describe, expect, it, vi } from "vitest"

import { searchWatchDirect } from "./watch-search-client"

describe("searchWatchDirect", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("maps subtitle-only availability separately from its audio action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              results: [
                {
                  type: "VIDEO",
                  id: "video-perfect-2",
                  slug: "perfect-2",
                  title: "Perfect?",
                  playbackId: "playback-en",
                  languageSlug: "russian",
                  languageEnglishName: "Russian",
                  availability: {
                    kind: "TARGET_SUBTITLE",
                    languageSlug: "russian",
                    languageEnglishName: "Russian",
                  },
                  action: { hrefLanguageSlug: "english" },
                },
              ],
              hasMore: false,
              query: "мария",
              searchMode: "watch-search",
              latencyMs: 8,
              nextOffset: 0,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const result = await searchWatchDirect({
      query: "мария",
      resolvedLanguage: {
        locale: "ru",
        publicSlug: "russian",
        englishName: "Russian",
        source: "explicit-selection",
      },
    })

    expect(result.results[0]).toMatchObject({
      languageSlug: "english",
      languageEnglishName: null,
      availabilityKind: "target_subtitle",
      subtitleLanguageSlug: "russian",
      availabilityLanguageEnglishName: "Russian",
    })
  })

  it("does not synthesize an audio route for subtitle-only rows without an action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              results: [
                {
                  type: "VIDEO",
                  id: "video-perfect-2",
                  slug: "perfect-2",
                  title: "Perfect?",
                  languageSlug: "russian",
                  availability: {
                    kind: "TARGET_SUBTITLE",
                    languageSlug: "russian",
                  },
                  action: { hrefLanguageSlug: null },
                },
              ],
              hasMore: false,
              query: "мария",
              searchMode: "watch-search",
              latencyMs: 8,
              nextOffset: 0,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const result = await searchWatchDirect({
      query: "мария",
      resolvedLanguage: {
        locale: "ru",
        publicSlug: "russian",
        englishName: "Russian",
        source: "explicit-selection",
      },
    })

    expect(result.results[0]).toMatchObject({
      languageSlug: null,
      subtitleLanguageSlug: "russian",
    })
  })
})
