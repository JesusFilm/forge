import { afterEach, describe, expect, it, vi } from "vitest"

import { searchWatchDirect, watchSearchErrorKind } from "./watch-search-client"

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
              languageInterpretation: {
                targetLanguageSlug: "english",
              },
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

    const result = await searchWatchDirect({
      query: "Jesus",
    })

    expect(result.targetLanguageSlug).toBe("english")

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

  it("keeps unavailable rows without a playable audio language", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              results: [
                {
                  type: "VIDEO",
                  id: "video-good-friday-live",
                  slug: "good-friday-live",
                  title: "Good Friday: Live",
                  languageSlug: null,
                  availability: {
                    kind: "UNAVAILABLE",
                    languageSlug: null,
                  },
                  action: { hrefLanguageSlug: null },
                },
              ],
              hasMore: false,
              query: "耶稣",
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
      query: "耶稣",
      resolvedLanguage: {
        locale: "zh-Hans",
        publicSlug: "chinese-simplified",
        englishName: "Chinese, Simplified",
        source: "explicit-selection",
      },
    })

    expect(result.results[0]).toMatchObject({
      availabilityKind: "unavailable",
      languageSlug: null,
    })
  })

  it("maps a CONTAINER availability to a browsable container result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            watchSearch: {
              results: [
                {
                  type: "VIDEO",
                  id: "video-easter",
                  slug: "easter",
                  title: "Easter",
                  label: "COLLECTION",
                  childCount: 29,
                  playbackId: null,
                  durationSeconds: null,
                  languageSlug: null,
                  availability: {
                    kind: "CONTAINER",
                    languageSlug: "english",
                    languageEnglishName: "English",
                  },
                  action: { hrefLanguageSlug: "english" },
                },
              ],
              hasMore: false,
              query: "Easter",
              searchMode: "watch-search",
              latencyMs: 8,
              nextOffset: 0,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const result = await searchWatchDirect({ query: "Easter" })

    expect(result.results[0]).toMatchObject({
      slug: "easter",
      availabilityKind: "container",
      languageSlug: "english",
      playbackId: null,
      childCount: 29,
    })
  })

  it("preserves a GraphQL-body 429 as a rate-limited search error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [
            {
              message: "Too many requests",
              extensions: { http: { statusCode: 429 } },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    await expect(searchWatchDirect({ query: "Jesus" })).rejects.toMatchObject({
      kind: "rate_limited",
    })
  })

  it("classifies an HTTP 5xx as a server search error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    )

    await expect(searchWatchDirect({ query: "Jesus" })).rejects.toMatchObject({
      kind: "server_error",
    })
  })

  it("classifies a fetch rejection as a network search error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("offline"),
    )

    await expect(searchWatchDirect({ query: "Jesus" })).rejects.toMatchObject({
      kind: "network_error",
    })
  })

  it("does not report a request timeout as a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    )

    await expect(searchWatchDirect({ query: "Jesus" })).rejects.toMatchObject({
      kind: "server_error",
    })
  })

  it("does not misclassify an unrelated error as a network failure", () => {
    expect(watchSearchErrorKind(new Error("unexpected"))).toBe("unknown")
  })
})
