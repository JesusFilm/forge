import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchResult } from "./search"

vi.mock("server-only", () => ({}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "accept-language": "pt-BR" })),
}))

vi.mock("./feature-flags", () => ({
  isWatchAlgoliaSearchEnabled: vi.fn(),
}))

vi.mock("./language-preference-server", () => ({
  readPreferredLanguageSlug: vi.fn(async () => null),
}))

vi.mock("./search-language-preference-server", () => ({
  readSearchLanguagePreferenceSlug: vi.fn(async () => null),
}))

vi.mock("./search", async () => {
  const actual = await vi.importActual<typeof import("./search")>("./search")
  return {
    ...actual,
    searchVideos: vi.fn(),
  }
})

vi.mock("./algolia-search", () => ({
  searchAlgoliaVideos: vi.fn(),
}))

vi.mock("./algolia-video-transform", () => ({
  transformAlgoliaVideoHits: vi.fn(),
}))

vi.mock("./watch-search-analytics", () => ({
  scheduleWatchSearchAnalyticsEvent: vi.fn(),
}))

import { searchAlgoliaVideos } from "./algolia-search"
import { transformAlgoliaVideoHits } from "./algolia-video-transform"
import { isWatchAlgoliaSearchEnabled } from "./feature-flags"
import { readPreferredLanguageSlug } from "./language-preference-server"
import { runSearch } from "./search-actions"
import { searchVideos } from "./search"
import { readSearchLanguagePreferenceSlug } from "./search-language-preference-server"
import { scheduleWatchSearchAnalyticsEvent } from "./watch-search-analytics"
import { WATCH_SEARCH_ANALYTICS_SURFACE } from "./watch-search-analytics-contract"

const spanishOption = {
  coreId: "21028",
  englishName: "Spanish, Castilian",
  nativeName: "Español",
  bcp47: "es-ES",
  publicSlug: "spanish-castilian",
  regionNames: ["Europe"],
}

const semanticResult: SearchResult = {
  type: "video",
  id: "semantic-1",
  slug: "jesus",
  title: "JESUS",
  imageUrl: null,
  snippet: "",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: 7200,
  childCount: 0,
}

const algoliaResult: SearchResult = {
  ...semanticResult,
  id: "algolia-1",
  source: "algolia",
  languageSlug: "spanish-castilian",
}

const watchAnalytics = {
  searchRequestId: "search_12345678",
  surface: WATCH_SEARCH_ANALYTICS_SURFACE,
}

describe("runSearch", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("keeps semantic search when the Algolia flag is off and passes the resolved locale", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 12,
    })

    const result = await runSearch({
      query: "jesus",
      limit: 5,
      offset: 10,
      languageSlug: "spanish-castilian",
      languageOptions: [spanishOption],
    })

    expect(searchVideos).toHaveBeenCalledWith("jesus", 5, 10, undefined, "es")
    expect(searchAlgoliaVideos).not.toHaveBeenCalled()
    expect(readSearchLanguagePreferenceSlug).not.toHaveBeenCalled()
    expect(readPreferredLanguageSlug).not.toHaveBeenCalled()
    expect(scheduleWatchSearchAnalyticsEvent).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      resultSource: "semantic",
      resolvedLanguage: {
        publicSlug: "spanish-castilian",
        source: "explicit-selection",
      },
      results: [
        {
          ...semanticResult,
          languageSlug: "spanish-castilian",
        },
      ],
    })
  })

  it("redacts semantic upstream errors returned to the browser", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockRejectedValueOnce({
      code: "ADMIN_GRAPHQL_ERROR",
      message: "database password leaked in upstream diagnostic",
      retryAfterSeconds: "not-a-number",
    })

    await expect(runSearch({ query: "jesus" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        resultSource: "semantic",
        error: {
          code: "SEARCH_ERROR",
          message: "Search request failed",
        },
      }),
    )
  })

  it("uses Algolia when the flag is on and transforms hits with the selected language", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      hasMore: true,
      nbHits: 21,
      page: 0,
      offset: 0,
      nextOffset: 20,
      facets: {
        languageEnglishName: {
          "Spanish, Castilian": 10,
        },
      },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([algoliaResult])

    const result = await runSearch({
      query: "jesus",
      limit: 20,
      offset: 0,
      languageEnglishNames: ["Spanish, Castilian"],
      languageOptions: [spanishOption],
    })

    expect(searchAlgoliaVideos).toHaveBeenCalledWith({
      includeLanguageFacets: false,
      query: "jesus",
      limit: 20,
      offset: 0,
      languageEnglishNames: ["Spanish, Castilian"],
    })
    expect(transformAlgoliaVideoHits).toHaveBeenCalledWith({
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      preferredLanguage: spanishOption,
      languageOptions: [spanishOption],
    })
    expect(result).toMatchObject({
      ok: true,
      resultSource: "algolia",
      searchMode: "hybrid",
      nextOffset: 20,
      results: [algoliaResult],
      languageFacets: {
        "Spanish, Castilian": 10,
      },
    })
  })

  it("caps selected language filters before calling Algolia", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [],
      hasMore: false,
      nbHits: 0,
      page: 0,
      offset: 0,
      nextOffset: 0,
      facets: { languageEnglishName: {} },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([])

    await runSearch({
      query: "jesus",
      languageEnglishNames: [
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
      ],
    })

    expect(searchAlgoliaVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        languageEnglishNames: [
          "English",
          "x".repeat(100),
          "Spanish",
          "French",
          "German",
          "Italian",
          "Portuguese",
          "Arabic",
        ],
      }),
    )
  })

  it("keeps type-filtered searches on semantic search when the Algolia flag is on", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 9,
      nextOffset: 0,
    })

    await runSearch({
      query: "jesus",
      type: "experience",
      limit: 5,
      offset: 10,
      routeLanguageSlug: "french",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "jesus",
      5,
      10,
      "experience",
      "fr",
    )
    expect(searchAlgoliaVideos).not.toHaveBeenCalled()
  })

  it("returns a safe failed result when the selected search path fails", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: false,
      query: "jesus",
      latencyMs: 3,
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
        message: "Algolia search is not configured for this environment.",
      },
    })

    await expect(runSearch({ query: "jesus" })).resolves.toMatchObject({
      ok: false,
      resultSource: "algolia",
      results: [],
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
      },
    })
    expect(transformAlgoliaVideoHits).not.toHaveBeenCalled()
  })

  it("schedules one completed Watch analytics event for semantic results", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 12,
    })

    await runSearch({
      analytics: watchAnalytics,
      languageEnglishNames: ["Spanish, Castilian"],
      languageOptions: [spanishOption],
      languageSlug: "spanish-castilian",
      query: "jesus",
      routeLanguageSlug: "english",
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledTimes(1)
    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        query: "jesus",
        requestType: "search",
        resultCount: 1,
        resultSource: "semantic",
        routeLanguageSlug: "english",
        searchLanguageEnglishName: "Spanish, Castilian",
        searchLanguageSlug: "spanish-castilian",
        searchRequestId: "search_12345678",
        surface: WATCH_SEARCH_ANALYTICS_SURFACE,
      }),
    )
  })

  it("classifies zero-result Watch searches as no_result", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "forgiveness",
      searchMode: "hybrid",
      latencyMs: 8,
    })

    await runSearch({
      analytics: watchAnalytics,
      query: "forgiveness",
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "no_result",
        query: "forgiveness",
        resultCount: 0,
      }),
    )
  })

  it("classifies failed Algolia searches as algolia_error analytics events", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: false,
      query: "jesus",
      latencyMs: 3,
      error: {
        code: "ALGOLIA_NOT_CONFIGURED",
        message: "Algolia search is not configured for this environment.",
      },
    })

    await runSearch({
      analytics: watchAnalytics,
      query: "jesus",
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCategory: "algolia_error",
        latencyMs: 3,
        outcome: "failed",
        query: "jesus",
        resultCount: 0,
        resultSource: "algolia",
      }),
    )
  })

  it("classifies transformed-empty Algolia searches as no_result", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      hasMore: false,
      nbHits: 1,
      page: 0,
      offset: 0,
      nextOffset: 1,
      facets: { languageEnglishName: {} },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([])

    await runSearch({
      analytics: watchAnalytics,
      query: "jesus",
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "no_result",
        query: "jesus",
        resultCount: 0,
        resultSource: "algolia",
      }),
    )
  })

  it("records successful load-more analytics with appended and visible counts", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      hasMore: false,
      nbHits: 1,
      page: 1,
      offset: 10,
      nextOffset: 11,
      facets: { languageEnglishName: {} },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([algoliaResult])

    await runSearch({
      analytics: {
        ...watchAnalytics,
        expectedResultSource: "algolia",
        requestType: "load_more",
        visibleResultCount: 10,
      },
      query: "jesus",
      offset: 10,
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        addedResultCount: 1,
        expectedResultSource: "algolia",
        offset: 10,
        outcome: "completed",
        requestType: "load_more",
        searchRequestId: "search_12345678",
        visibleResultCount: 11,
      }),
    )
  })

  it("records load-more source mismatch as an analytics failure without changing the response", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(true)
    vi.mocked(searchAlgoliaVideos).mockResolvedValueOnce({
      ok: true,
      query: "jesus",
      latencyMs: 20,
      hits: [{ objectID: "variant-1", videoId: "video-1", slug: "jesus" }],
      hasMore: false,
      nbHits: 1,
      page: 1,
      offset: 10,
      nextOffset: 11,
      facets: { languageEnglishName: {} },
    })
    vi.mocked(transformAlgoliaVideoHits).mockReturnValueOnce([algoliaResult])

    await expect(
      runSearch({
        analytics: {
          ...watchAnalytics,
          expectedResultSource: "semantic",
          requestType: "load_more",
          visibleResultCount: 10,
        },
        query: "jesus",
        offset: 10,
      }),
    ).resolves.toMatchObject({
      ok: true,
      resultSource: "algolia",
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCategory: "source_mismatch",
        addedResultCount: 0,
        offset: 10,
        outcome: "failed",
        requestType: "load_more",
        visibleResultCount: 10,
      }),
    )
  })

  it("uses elapsed analytics latency for semantic failures while returning a redacted response", async () => {
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(137)
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockRejectedValueOnce(new Error("upstream failed"))

    try {
      await expect(
        runSearch({
          analytics: watchAnalytics,
          query: "jesus",
        }),
      ).resolves.toMatchObject({
        ok: false,
        latencyMs: 0,
        resultSource: "semantic",
      })
    } finally {
      performanceNow.mockRestore()
    }

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCategory: "semantic_error",
        latencyMs: 37,
        outcome: "failed",
        resultSource: "semantic",
      }),
    )
  })

  it("omits untrusted language names and client Watch context from canonical server analytics", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 8,
    })

    await runSearch({
      analytics: {
        ...watchAnalytics,
        watchContext: {
          pageRoute: "/watch?token=secret",
          videoId: "user@example.com",
        },
      },
      languageEnglishNames: ["person@example.com"],
      languageOptions: [],
      query: "jesus",
    })

    const analyticsInput = vi.mocked(scheduleWatchSearchAnalyticsEvent).mock
      .calls[0]?.[0]
    expect(analyticsInput).toMatchObject({
      query: "jesus",
      watchContext: null,
    })
    expect(analyticsInput).not.toHaveProperty("searchLanguageEnglishName")
    expect(analyticsInput).not.toHaveProperty("searchLanguageSlug")
  })

  it("preserves the search response if analytics scheduling throws", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
      latencyMs: 12,
    })
    vi.mocked(scheduleWatchSearchAnalyticsEvent).mockImplementationOnce(() => {
      throw new Error("Datadog unavailable")
    })

    await expect(
      runSearch({
        analytics: watchAnalytics,
        query: "jesus",
      }),
    ).resolves.toMatchObject({
      ok: true,
      resultSource: "semantic",
    })
  })

  it("schedules a failed event before preserving unexpected pre-return errors", async () => {
    vi.mocked(isWatchAlgoliaSearchEnabled).mockRejectedValueOnce(
      new Error("flag failed"),
    )

    await expect(
      runSearch({
        analytics: watchAnalytics,
        query: "jesus",
      }),
    ).rejects.toThrow("flag failed")

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCategory: "unexpected_error",
        outcome: "failed",
        query: "jesus",
        searchRequestId: "search_12345678",
      }),
    )
  })

  it("records the capped server-executed query", async () => {
    const longQuery = "x".repeat(250)
    const cappedQuery = "x".repeat(200)
    vi.mocked(isWatchAlgoliaSearchEnabled).mockResolvedValueOnce(false)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: cappedQuery,
      searchMode: "hybrid",
      latencyMs: 4,
    })

    await runSearch({
      analytics: watchAnalytics,
      query: longQuery,
    })

    expect(searchVideos).toHaveBeenCalledWith(
      cappedQuery,
      undefined,
      undefined,
      undefined,
      expect.any(String),
    )
    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        query: cappedQuery,
      }),
    )
  })
})
