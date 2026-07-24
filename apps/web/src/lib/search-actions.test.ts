import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchResult } from "./search"

const { adminMutate } = vi.hoisted(() => ({
  adminMutate: vi.fn(),
}))

vi.mock("server-only", () => ({}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "accept-language": "pt-BR" })),
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

vi.mock("./watch-search-analytics", () => ({
  scheduleWatchSearchAnalyticsEvent: vi.fn(),
}))

vi.mock("./search-language-actions", () => ({
  getSearchLanguageOptions: vi.fn(async () => ({
    ok: true,
    options: [],
    countrySuggestion: null,
    recommendedLanguage: null,
    countryCode: null,
    countryName: null,
  })),
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    mutate: adminMutate,
  },
}))

import { readPreferredLanguageSlug } from "./language-preference-server"
import {
  recordWatchSearchResultClick,
  recordWatchSearchResultsViewed,
  runSearch,
} from "./search-actions"
import { searchVideos } from "./search"
import { getSearchLanguageOptions } from "./search-language-actions"
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

const englishOption = {
  coreId: "529",
  englishName: "English",
  nativeName: "English",
  bcp47: "en",
  publicSlug: "english",
  regionNames: ["Europe"],
}

const russianOption = {
  coreId: "3934",
  englishName: "Russian",
  nativeName: "Русский",
  bcp47: "ru",
  publicSlug: "russian",
  regionNames: ["Europe"],
}

const semanticResult: SearchResult = {
  type: "video",
  id: "watch-search-1",
  slug: "jesus",
  title: "JESUS",
  imageUrl: null,
  imageBlurDataUrl: null,
  muxThumbnailBlurDataUrl: null,
  snippet: "",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: 7200,
  childCount: 0,
}

const watchAnalytics = {
  searchRequestId: "search_12345678",
  surface: WATCH_SEARCH_ANALYTICS_SURFACE,
}

describe("runSearch", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    adminMutate.mockResolvedValue({
      data: { recordWatchSearchEvent: { id: "event-1" } },
    })
    vi.mocked(getSearchLanguageOptions).mockResolvedValue({
      ok: true,
      options: [],
      countrySuggestion: null,
      recommendedLanguage: null,
      countryCode: null,
      countryName: null,
    })
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it.each([
    {
      name: "keeps an absent route absent for the default English UI locale",
      uiLocale: "en",
      routeLanguageSlug: undefined,
      expectedDisplayLanguageSlug: "english",
      expectedRouteLanguageSlug: undefined,
    },
    {
      name: "maps the Spanish UI locale to its canonical display language",
      uiLocale: "es",
      routeLanguageSlug: undefined,
      expectedDisplayLanguageSlug: "spanish-castilian",
      expectedRouteLanguageSlug: undefined,
    },
    {
      name: "preserves canonical English route context",
      uiLocale: "en",
      routeLanguageSlug: "english",
      expectedDisplayLanguageSlug: "english",
      expectedRouteLanguageSlug: "english",
    },
    {
      name: "preserves an explicitly null route language",
      uiLocale: "en",
      routeLanguageSlug: null,
      expectedDisplayLanguageSlug: "english",
      expectedRouteLanguageSlug: null,
    },
    {
      name: "rejects a locale code supplied as route language identity",
      uiLocale: "en",
      routeLanguageSlug: "en",
      expectedDisplayLanguageSlug: "english",
      expectedRouteLanguageSlug: null,
    },
  ])(
    "$name",
    async ({
      expectedDisplayLanguageSlug,
      expectedRouteLanguageSlug,
      routeLanguageSlug,
      uiLocale,
    }) => {
      vi.mocked(searchVideos).mockResolvedValueOnce({
        results: [],
        hasMore: false,
        query: "jesus",
        searchMode: "watch-search",
        latencyMs: 4,
      })

      await runSearch({
        query: "jesus",
        routeLanguageSlug,
        uiLocale,
      })

      expect(searchVideos).toHaveBeenCalledWith(
        "jesus",
        undefined,
        undefined,
        "video",
        uiLocale,
        expect.objectContaining({
          displayLanguageSlug: expectedDisplayLanguageSlug,
          routeLanguageSlug: expectedRouteLanguageSlug,
          targetLanguageSlug: null,
        }),
      )
    },
  )

  it("keeps an explicit Spanish target separate without synthesizing result route language", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    const result = await runSearch({
      query: "jesus",
      limit: 5,
      offset: 10,
      languageSlug: "spanish-castilian",
      languageOptions: [spanishOption],
      uiLocale: "en",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "jesus",
      5,
      10,
      "video",
      "en",
      expect.objectContaining({
        acceptLanguage: "pt-BR",
        clientRequestId: undefined,
        displayLanguageSlug: "english",
        routeLanguageSlug: undefined,
        targetLanguageSlug: "spanish-castilian",
      }),
    )
    expect(readSearchLanguagePreferenceSlug).not.toHaveBeenCalled()
    expect(readPreferredLanguageSlug).not.toHaveBeenCalled()
    expect(scheduleWatchSearchAnalyticsEvent).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      resultSource: "watch-search",
      resolvedLanguage: {
        publicSlug: "spanish-castilian",
        source: "explicit-selection",
      },
      results: [semanticResult],
    })
    expect(result.results[0]).not.toHaveProperty("languageSlug")
  })

  it("passes the analytics request id through Watch search calls", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "How can I know God?",
      searchMode: "watch-search",
      latencyMs: 12,
      requestId: "search_12345678",
    })

    await runSearch({
      analytics: watchAnalytics,
      query: "How can I know God?",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "How can I know God?",
      undefined,
      undefined,
      "video",
      expect.any(String),
      expect.objectContaining({
        clientRequestId: "search_12345678",
      }),
    )
  })

  it("uses a language name typed in the query as the target language", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "JESUS Russian",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    await runSearch({
      query: "JESUS Russian",
      limit: 5,
      languageEnglishNames: ["English"],
      languageOptions: [englishOption, russianOption],
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "JESUS Russian",
      5,
      undefined,
      "video",
      "en",
      expect.objectContaining({
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: null,
      }),
    )
  })

  it("loads language options server-side when the first search races ahead of client metadata", async () => {
    vi.mocked(getSearchLanguageOptions).mockResolvedValueOnce({
      ok: true,
      options: [englishOption, russianOption],
      countrySuggestion: null,
      recommendedLanguage: null,
      countryCode: null,
      countryName: null,
    })
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "JESUS Russian",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    await runSearch({
      query: "JESUS Russian",
      limit: 5,
      languageEnglishNames: ["English"],
      languageOptions: [],
    })

    expect(getSearchLanguageOptions).toHaveBeenCalledOnce()
    expect(searchVideos).toHaveBeenCalledWith(
      "JESUS Russian",
      5,
      undefined,
      "video",
      "en",
      expect.objectContaining({
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: null,
      }),
    )
  })

  it("lets a typed language override a non-explicit default language slug", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "JESUS Russian",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    await runSearch({
      query: "JESUS Russian",
      languageEnglishNames: ["English"],
      languageOptions: [englishOption, russianOption],
      languageSlug: "english",
      languageSlugIsExplicit: false,
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "JESUS Russian",
      undefined,
      undefined,
      "video",
      "en",
      expect.objectContaining({
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: null,
      }),
    )
  })

  it("keeps an explicit dropdown language ahead of a language typed in the query", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "JESUS Russian",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    await runSearch({
      query: "JESUS Russian",
      languageSlug: "spanish-castilian",
      languageOptions: [spanishOption, russianOption],
      uiLocale: "en",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "JESUS Russian",
      undefined,
      undefined,
      "video",
      "en",
      expect.objectContaining({
        displayLanguageSlug: "english",
        queryNamedLanguageSlug: "russian",
        targetLanguageSlug: "spanish-castilian",
      }),
    )
  })

  it("redacts semantic upstream errors returned to the browser", async () => {
    vi.mocked(searchVideos).mockRejectedValueOnce({
      code: "ADMIN_GRAPHQL_ERROR",
      message: "database password leaked in upstream diagnostic",
      retryAfterSeconds: "not-a-number",
    })

    await expect(runSearch({ query: "jesus" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        resultSource: "watch-search",
        error: {
          code: "SEARCH_ERROR",
          message: "Search request failed",
        },
      }),
    )
  })

  it("keeps type-filtered searches on the semantic shim", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
      latencyMs: 9,
      nextOffset: 0,
    })

    await runSearch({
      query: "jesus",
      type: "experience",
      limit: 5,
      offset: 10,
      routeLanguageSlug: "french",
      uiLocale: "fr",
    })

    expect(searchVideos).toHaveBeenCalledWith(
      "jesus",
      5,
      10,
      "experience",
      "fr",
      expect.objectContaining({
        acceptLanguage: "pt-BR",
        routeLanguageSlug: "french",
        targetLanguageSlug: null,
      }),
    )
  })

  it("returns a safe failed result when the selected search path fails", async () => {
    vi.mocked(searchVideos).mockRejectedValueOnce({
      code: "ADMIN_GRAPHQL_ERROR",
      message: "upstream failed",
    })

    await expect(runSearch({ query: "jesus" })).resolves.toMatchObject({
      ok: false,
      resultSource: "watch-search",
      results: [],
      error: {
        code: "SEARCH_ERROR",
      },
    })
  })

  it("schedules one completed Watch analytics event for semantic results", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      requestId: "admin_request_123",
      degraded: true,
      laneStatuses: [
        {
          lane: "semantic_retrieval",
          status: "degraded",
          elapsedMs: 19,
          resultCount: 1,
          reason: "partial_locale_failure",
        },
      ],
      query: "jesus",
      searchMode: "watch-search",
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
        resultSource: "watch-search",
        routeLanguageSlug: "english",
        degraded: true,
        laneStatuses: [
          {
            lane: "semantic_retrieval",
            status: "degraded",
            elapsedMs: 19,
            resultCount: 1,
            reason: "partial_locale_failure",
          },
        ],
        searchLanguageEnglishName: "Spanish, Castilian",
        searchLanguageSlug: "spanish-castilian",
        searchRequestId: "admin_request_123",
        surface: WATCH_SEARCH_ANALYTICS_SURFACE,
      }),
    )
  })

  it("uses end-to-end elapsed latency for successful search analytics", async () => {
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(149)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
      latencyMs: 12,
    })

    try {
      await runSearch({
        analytics: watchAnalytics,
        query: "jesus",
      })
    } finally {
      performanceNow.mockRestore()
    }

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        latencyMs: 49,
        outcome: "completed",
      }),
    )
  })

  it("classifies zero-result Watch searches as no_result", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "forgiveness",
      searchMode: "watch-search",
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

  it("records successful load-more analytics with appended and visible counts", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
      latencyMs: 12,
      nextOffset: 11,
    })

    await runSearch({
      analytics: {
        ...watchAnalytics,
        expectedResultSource: "watch-search",
        requestType: "load_more",
        visibleResultCount: 10,
      },
      query: "jesus",
      offset: 10,
    })

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        addedResultCount: 1,
        expectedResultSource: "watch-search",
        offset: 10,
        outcome: "completed",
        requestType: "load_more",
        searchRequestId: "search_12345678",
        visibleResultCount: 11,
      }),
    )
  })

  it("uses elapsed analytics latency for semantic failures while returning a redacted response", async () => {
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(137)
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
        resultSource: "watch-search",
      })
    } finally {
      performanceNow.mockRestore()
    }

    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCategory: "watch_search_error",
        latencyMs: 37,
        outcome: "failed",
        resultSource: "watch-search",
      }),
    )
  })

  it("omits untrusted language names and client Watch context from canonical server analytics", async () => {
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
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
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [semanticResult],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
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
      resultSource: "watch-search",
    })
  })

  it("records the capped server-executed query", async () => {
    const longQuery = "x".repeat(250)
    const cappedQuery = "x".repeat(200)
    vi.mocked(searchVideos).mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: cappedQuery,
      searchMode: "watch-search",
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
      "video",
      expect.any(String),
      expect.objectContaining({
        acceptLanguage: "pt-BR",
        targetLanguageSlug: null,
      }),
    )
    expect(scheduleWatchSearchAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        query: cappedQuery,
      }),
    )
  })

  it("records Watch search result clicks through Admin without raw result text", async () => {
    await expect(
      recordWatchSearchResultClick({
        requestId: "search_12345678",
        resultId: "video-123",
        resultType: "video",
        position: 2.8,
        visibleResultIds: ["video-123", "bad id", "video-456"],
        routeLanguageSlug: "english",
        searchLanguageSlug: "russian",
      }),
    ).resolves.toEqual({ ok: true })

    expect(adminMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          requestId: "search_12345678",
          eventType: "RESULT_CLICKED",
          client: "WEB",
          resultId: "video-123",
          resultType: "VIDEO",
          position: 2,
          visibleResultIds: ["video-123", "video-456"],
          routeLanguageSlug: "english",
          searchLanguageSlug: "russian",
          occurredAt: expect.any(String),
        }),
      }),
    )
    expect(
      JSON.stringify(adminMutate.mock.calls[0]?.[0]?.variables),
    ).not.toContain("JESUS")
  })

  it("records Watch search result impressions through Admin without raw result text", async () => {
    await expect(
      recordWatchSearchResultsViewed({
        requestId: "search_12345678",
        visibleResultIds: ["video-123", "bad id", "video-456"],
        routeLanguageSlug: "english",
        searchLanguageSlug: "russian",
      }),
    ).resolves.toEqual({ ok: true })

    expect(adminMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          requestId: "search_12345678",
          eventType: "RESULTS_VIEWED",
          client: "WEB",
          resultId: null,
          resultType: null,
          position: null,
          visibleResultIds: ["video-123", "video-456"],
          routeLanguageSlug: "english",
          searchLanguageSlug: "russian",
          occurredAt: expect.any(String),
        }),
      }),
    )
    expect(
      JSON.stringify(adminMutate.mock.calls[0]?.[0]?.variables),
    ).not.toContain("JESUS")
  })

  it("treats Watch search click recording as best-effort", async () => {
    adminMutate.mockRejectedValueOnce(new Error("admin unavailable"))

    await expect(
      recordWatchSearchResultClick({
        requestId: "search_12345678",
        resultId: "video-123",
        resultType: "video",
        position: 1,
      }),
    ).resolves.toEqual({ ok: false })
  })
})
