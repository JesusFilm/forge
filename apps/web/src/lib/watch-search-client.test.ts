import { afterEach, describe, expect, it, vi } from "vitest"

import { searchWatchDirect } from "./watch-search-client"

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql",
  },
}))

describe("searchWatchDirect", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends the typed Watch search operation directly to Admin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              requestId: "request-1",
              query: "Jesus",
              degraded: false,
              laneStatuses: [],
              results: [],
              hasMore: false,
              searchMode: "watch-search-typesense",
              latencyMs: 42,
              nextOffset: 0,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await searchWatchDirect({
      query: "Jesus",
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://admin.test/api/graphql")
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.method).toBe("POST")
    expect(init?.body).toEqual(expect.any(String))
    const body = JSON.parse(String(init?.body)) as {
      query: string
      variables: { input: Record<string, unknown> }
    }
    expect(body.query).toContain("watchSearch")
    expect(body).toMatchObject({
      variables: {
        input: {
          query: "Jesus",
        },
      },
    })
    expect(body.variables.input).not.toHaveProperty("mode")
    expect(body.variables.input).not.toHaveProperty("shadowMode")
    expect(body.variables.input).not.toHaveProperty("profile")
    expect(body.variables.input).not.toHaveProperty("generationId")
    expect(body.variables.input).not.toHaveProperty("candidate")
  })

  it("repairs a legacy Video title that equals its raw search slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              watchSearch: {
                results: [
                  {
                    type: "VIDEO",
                    id: "video-1",
                    slug: "miraculous-catch-of-fish",
                    title: "miraculous-catch-of-fish",
                    snippet: "",
                    score: 1,
                  },
                ],
                hasMore: false,
                query: "fish",
                searchMode: "watch-search",
                latencyMs: 1,
                nextOffset: 0,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )

    const data = await searchWatchDirect({ query: "fish" })

    expect(data.results[0]?.title).toBe("Miraculous Catch Of Fish")
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
