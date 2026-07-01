import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const mockEnv = vi.hoisted<{
  ALGOLIA_APP_ID: string | undefined
  ALGOLIA_SEARCH_API_KEY: string | undefined
  ALGOLIA_INDEX: string | undefined
}>(() => ({
  ALGOLIA_APP_ID: "TESTAPP",
  ALGOLIA_SEARCH_API_KEY: "test-key",
  ALGOLIA_INDEX: "video-variants-test",
}))

vi.mock("@/env", () => ({ env: mockEnv }))

import {
  WATCH_VISIBILITY_FILTER,
  buildWatchAlgoliaFilters,
  searchAlgoliaVideos,
} from "./algolia-search"

describe("buildWatchAlgoliaFilters", () => {
  it("returns Core's Watch visibility filter when no language is selected", () => {
    expect(buildWatchAlgoliaFilters()).toBe(WATCH_VISIBILITY_FILTER)
  })

  it("ORs selected languageEnglishName facets with escaped string values", () => {
    expect(
      buildWatchAlgoliaFilters([
        "Spanish, Castilian",
        'French "Europe"',
        "Spanish, Castilian",
      ]),
    ).toBe(
      `${WATCH_VISIBILITY_FILTER} AND (languageEnglishName:"Spanish, Castilian" OR languageEnglishName:"French \\"Europe\\"")`,
    )
  })

  it("trims, caps, and deduplicates client-provided language filters", () => {
    const filters = buildWatchAlgoliaFilters([
      " English ",
      "English",
      "x".repeat(120),
      "Spanish",
      "French",
      "German",
      "Italian",
      "Portuguese",
      "Arabic",
      "Hindi",
    ])

    expect(filters).toContain('languageEnglishName:"English"')
    expect(filters).toContain(`languageEnglishName:"${"x".repeat(100)}"`)
    expect(filters).toContain('languageEnglishName:"Arabic"')
    expect(filters).not.toContain('languageEnglishName:"Hindi"')
  })
})

describe("searchAlgoliaVideos", () => {
  const fetchMock = vi.fn<typeof fetch>()
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    mockEnv.ALGOLIA_APP_ID = "TESTAPP"
    mockEnv.ALGOLIA_SEARCH_API_KEY = "test-key"
    mockEnv.ALGOLIA_INDEX = "video-variants-test"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    consoleError.mockClear()
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    })
  }

  it("queries Algolia with headers, pagination, filters, and language facets", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
        nbHits: 21,
        facets: {
          languageEnglishName: {
            English: 12,
            "Spanish, Castilian": 9,
          },
        },
      }),
    )

    const result = await searchAlgoliaVideos({
      query: "jesus",
      limit: 10,
      offset: 10,
      languageEnglishNames: ["Spanish, Castilian"],
    })

    expect(result).toMatchObject({
      ok: true,
      query: "jesus",
      hasMore: true,
      nbHits: 21,
      offset: 10,
      nextOffset: 20,
      page: 1,
      facets: {
        languageEnglishName: {
          English: 12,
          "Spanish, Castilian": 9,
        },
      },
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      "https://TESTAPP-dsn.algolia.net/1/indexes/video-variants-test/query",
    )
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).cache).toBe("no-store")
    expect((init as RequestInit).headers).toMatchObject({
      "X-Algolia-API-Key": "test-key",
      "X-Algolia-Application-Id": "TESTAPP",
      "Content-Type": "application/json",
      Accept: "application/json",
    })
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      query: "jesus",
      offset: 10,
      length: 10,
      filters: `${WATCH_VISIBILITY_FILTER} AND (languageEnglishName:"Spanish, Castilian")`,
      facets: ["languageEnglishName"],
      maxValuesPerFacet: 1000,
    })
  })

  it("can skip language facet requests for load-more and filtered searches", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [],
        nbHits: 0,
        facets: {
          languageEnglishName: {
            English: 12,
          },
        },
      }),
    )

    const result = await searchAlgoliaVideos({
      includeLanguageFacets: false,
      query: "jesus",
    })

    expect(result).toMatchObject({
      ok: true,
      facets: { languageEnglishName: {} },
    })
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    )
    expect(body).not.toHaveProperty("facets")
    expect(body).not.toHaveProperty("maxValuesPerFacet")
  })

  it("returns a safe not-configured result without calling fetch", async () => {
    mockEnv.ALGOLIA_INDEX = undefined

    await expect(
      searchAlgoliaVideos({ query: "jesus" }),
    ).resolves.toMatchObject({
      ok: false,
      query: "jesus",
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
        message: "Algolia search is not configured for this environment.",
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns a safe upstream error for non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }))

    await expect(
      searchAlgoliaVideos({ query: "jesus" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ALGOLIA_UPSTREAM_ERROR" },
    })
  })

  it("does not print raw query text in ordinary Algolia error logs", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network failed"))

    await searchAlgoliaVideos({ query: "person@example.com" })

    expect(consoleError).toHaveBeenCalled()
    const message = String(consoleError.mock.calls[0]?.[0])
    expect(message).toContain("[watch-search][algolia] fetch failed")
    expect(message).not.toContain("person@example.com")
    expect(message).not.toContain("q=")
  })

  it("returns an invalid response error when hits is missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nbHits: 0 }))

    await expect(
      searchAlgoliaVideos({ query: "jesus" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ALGOLIA_INVALID_RESPONSE" },
    })
  })

  it("clamps limit and truncates long queries", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ hits: [], nbHits: 0, nbPages: 0, page: 0 }),
    )

    await searchAlgoliaVideos({ query: "x".repeat(250), limit: 999 })

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    )
    expect(body.query).toHaveLength(200)
    expect(body.length).toBe(50)
  })

  it("preserves absolute offset semantics for non-page-aligned requests", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
        nbHits: 100,
        facets: { languageEnglishName: {} },
      }),
    )

    const result = await searchAlgoliaVideos({
      query: "jesus",
      limit: 20,
      offset: 19,
    })

    expect(result).toMatchObject({
      ok: true,
      offset: 19,
      nextOffset: 39,
      hasMore: true,
    })
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    )
    expect(body).toMatchObject({
      offset: 19,
      length: 20,
    })
  })
})
