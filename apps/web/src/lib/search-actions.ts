"use server"

import { headers } from "next/headers"

import { isWatchAlgoliaSearchEnabled } from "./feature-flags"
import { searchAlgoliaVideos } from "./algolia-search"
import { transformAlgoliaVideoHits } from "./algolia-video-transform"
import { isPublicWatchLanguageSlug } from "./locale"
import {
  searchVideos,
  type SearchContentType,
  type SearchActionResult,
  type SearchActionResultSource,
  type SearchError,
  type SearchResult,
} from "./search"
import {
  findSearchLanguageOptionByEnglishName,
  normalizeSearchLanguageEnglishNames,
  resolveSearchLanguage,
  type SearchLanguageOption,
} from "./search-language"
import {
  scheduleWatchSearchAnalyticsEvent,
  type WatchSearchFailureCategory,
} from "./watch-search-analytics"
import {
  WATCH_SEARCH_ANALYTICS_SURFACE,
  type WatchSearchAnalyticsInput,
  type WatchSearchRequestType,
} from "./watch-search-analytics-contract"

// Server-action wrapper around `searchVideos` for client-component callers
// (search overlay, load-more button). The browser cannot reach admin
// directly — admin requires a server-side bearer set via WEB_ADMIN_API_KEYS
// — so client-side searches dispatch through this action which runs on the
// Next.js server. It also owns the LaunchDarkly fork for the Algolia-backed
// Watch video search so the modal stays canonical on the client.
//
// The "use server" directive limits this file to exporting async functions
// only; the type for the action shape itself lives in search.ts.

const DEFAULT_SEARCH_MODE = "hybrid"

export async function runSearch(input: {
  analytics?: WatchSearchAnalyticsInput
  query: string
  limit?: number
  offset?: number
  type?: SearchContentType
  languageEnglishNames?: string[]
  languageOptions?: SearchLanguageOption[]
  languageSlug?: string | null
  routeLanguageSlug?: string | null
}): Promise<SearchActionResult> {
  const {
    analytics,
    query,
    limit,
    offset,
    type,
    languageEnglishNames = [],
    languageOptions = [],
    languageSlug,
    routeLanguageSlug,
  } = input

  const truncatedQuery = query.slice(0, 200)
  const startedAt = performance.now()
  let resolvedLanguageForAnalytics:
    | SearchActionResult["resolvedLanguage"]
    | null = null
  let attemptedResultSource: SearchActionResultSource | null = null
  const selectedLanguageEnglishNames =
    normalizeSearchLanguageEnglishNames(languageEnglishNames)

  try {
    const [flagEnabled, acceptLanguage] = await Promise.all([
      isWatchAlgoliaSearchEnabled({
        custom: { surface: "floating-search-modal" },
      }),
      readAcceptLanguageHeader(),
    ])

    const resolvedLanguage = resolveSearchLanguage({
      selectedEnglishNames: selectedLanguageEnglishNames,
      explicitSlug: languageSlug,
      routeLanguageSlug,
      acceptLanguage,
      languageOptions,
    })
    resolvedLanguageForAnalytics = resolvedLanguage

    if (!flagEnabled || type != null) {
      attemptedResultSource = "semantic"
      try {
        const response = await searchVideos(
          truncatedQuery,
          limit,
          offset,
          type,
          resolvedLanguage.locale,
        )
        const result: SearchActionResult = {
          ...response,
          results: withResolvedLanguageSlug(response.results, resolvedLanguage),
          ok: true,
          resultSource: "semantic",
          resolvedLanguage,
        }
        scheduleAnalyticsForResponse({
          analytics,
          languageOptions,
          languageSlug,
          offset,
          response: result,
          routeLanguageSlug,
          selectedLanguageEnglishNames,
        })
        return result
      } catch (error) {
        const result: SearchActionResult = {
          ok: false,
          results: [],
          hasMore: false,
          query: truncatedQuery,
          searchMode: DEFAULT_SEARCH_MODE,
          latencyMs: 0,
          resultSource: "semantic",
          resolvedLanguage,
          error: normalizeSearchError(error),
        }
        scheduleAnalyticsForResponse({
          analytics,
          analyticsLatencyMs: performance.now() - startedAt,
          languageOptions,
          languageSlug,
          offset,
          response: result,
          routeLanguageSlug,
          selectedLanguageEnglishNames,
        })
        return result
      }
    }

    attemptedResultSource = "algolia"
    const algolia = await searchAlgoliaVideos({
      includeLanguageFacets:
        (offset ?? 0) === 0 && selectedLanguageEnglishNames.length === 0,
      query: truncatedQuery,
      limit,
      offset,
      languageEnglishNames: selectedLanguageEnglishNames,
    })

    if (!algolia.ok) {
      const result: SearchActionResult = {
        ok: false,
        results: [],
        hasMore: false,
        query: algolia.query,
        searchMode: DEFAULT_SEARCH_MODE,
        latencyMs: algolia.latencyMs,
        resultSource: "algolia",
        resolvedLanguage,
        error: algolia.error,
      }
      scheduleAnalyticsForResponse({
        analytics,
        languageOptions,
        languageSlug,
        offset,
        response: result,
        routeLanguageSlug,
        selectedLanguageEnglishNames,
      })
      return result
    }

    const preferredLanguage = preferredSearchLanguage({
      languageEnglishNames: selectedLanguageEnglishNames,
      languageOptions,
      resolvedLanguage,
    })
    const results: SearchResult[] = transformAlgoliaVideoHits({
      hits: algolia.hits,
      preferredLanguage,
      languageOptions,
    })

    const result: SearchActionResult = {
      ok: true,
      results,
      hasMore: algolia.hasMore,
      query: algolia.query,
      searchMode: DEFAULT_SEARCH_MODE,
      latencyMs: algolia.latencyMs,
      nextOffset: algolia.nextOffset,
      resultSource: "algolia",
      resolvedLanguage,
      languageFacets: algolia.facets.languageEnglishName,
    }
    scheduleAnalyticsForResponse({
      analytics,
      languageOptions,
      languageSlug,
      offset,
      response: result,
      routeLanguageSlug,
      selectedLanguageEnglishNames,
    })
    return result
  } catch (error) {
    scheduleAnalyticsForUnexpectedFailure({
      analytics,
      elapsedMs: performance.now() - startedAt,
      languageOptions,
      languageSlug,
      offset,
      query: truncatedQuery,
      resolvedLanguage: resolvedLanguageForAnalytics,
      resultSource: attemptedResultSource,
      routeLanguageSlug,
      selectedLanguageEnglishNames,
    })
    throw error
  }
}

function scheduleAnalyticsForResponse({
  analytics,
  analyticsLatencyMs,
  languageOptions,
  languageSlug,
  offset,
  response,
  routeLanguageSlug,
  selectedLanguageEnglishNames,
}: {
  analytics?: WatchSearchAnalyticsInput
  analyticsLatencyMs?: number | null
  languageOptions: readonly SearchLanguageOption[]
  languageSlug?: string | null
  offset?: number
  response: SearchActionResult
  routeLanguageSlug?: string | null
  selectedLanguageEnglishNames: readonly string[]
}): void {
  if (!isWatchSearchAnalyticsSurface(analytics)) return

  const requestType = normalizeAnalyticsRequestType(analytics.requestType)
  const sourceMismatch =
    requestType === "load_more" &&
    analytics.expectedResultSource != null &&
    response.resultSource !== analytics.expectedResultSource
  const failureCategory = sourceMismatch
    ? "source_mismatch"
    : response.ok
      ? null
      : failureCategoryForResultSource(response.resultSource)
  const analyticsSucceeded = response.ok && !failureCategory
  const resultCount = response.results.length
  const acceptedResultCount = analyticsSucceeded ? resultCount : 0
  const addedResultCount =
    requestType === "load_more" ? acceptedResultCount : null
  const visibleResultCount =
    requestType === "load_more"
      ? (safeNonNegativeInt(analytics.visibleResultCount) ?? 0) +
        acceptedResultCount
      : resultCount
  const outcome = failureCategory
    ? "failed"
    : resultCount === 0
      ? "no_result"
      : "completed"

  const languageAttributes = trustedSearchLanguageAttributes({
    languageOptions,
    selectedLanguageEnglishNames,
    languageSlug,
  })

  safeScheduleWatchSearchAnalyticsEvent({
    detectedQueryLanguage: analytics.detectedQueryLanguage,
    expectedResultSource: analytics.expectedResultSource,
    failureCategory,
    addedResultCount,
    latencyMs: analyticsLatencyMs ?? response.latencyMs,
    offset,
    outcome,
    query: response.query,
    requestType,
    requestedSearchMode: DEFAULT_SEARCH_MODE,
    resolvedLanguageSlug: response.resolvedLanguage.publicSlug,
    responseSearchMode: response.searchMode,
    resultCount,
    resultSource: response.resultSource,
    routeLanguageSlug,
    ...languageAttributes,
    searchRequestId: analytics.searchRequestId,
    surface: analytics.surface,
    visibleResultCount,
    watchContext: null,
  })
}

function scheduleAnalyticsForUnexpectedFailure({
  analytics,
  elapsedMs,
  languageOptions,
  languageSlug,
  offset,
  query,
  resolvedLanguage,
  resultSource,
  routeLanguageSlug,
  selectedLanguageEnglishNames,
}: {
  analytics?: WatchSearchAnalyticsInput
  elapsedMs: number
  languageOptions: readonly SearchLanguageOption[]
  languageSlug?: string | null
  offset?: number
  query: string
  resolvedLanguage: SearchActionResult["resolvedLanguage"] | null
  resultSource: SearchActionResultSource | null
  routeLanguageSlug?: string | null
  selectedLanguageEnglishNames: readonly string[]
}): void {
  if (!isWatchSearchAnalyticsSurface(analytics)) return

  const requestType = normalizeAnalyticsRequestType(analytics.requestType)
  const languageAttributes = trustedSearchLanguageAttributes({
    languageOptions,
    selectedLanguageEnglishNames,
    languageSlug,
  })

  safeScheduleWatchSearchAnalyticsEvent({
    detectedQueryLanguage: analytics.detectedQueryLanguage,
    expectedResultSource: analytics.expectedResultSource,
    failureCategory: "unexpected_error",
    latencyMs: elapsedMs,
    offset,
    outcome: "failed",
    query,
    requestType,
    requestedSearchMode: DEFAULT_SEARCH_MODE,
    resolvedLanguageSlug: resolvedLanguage?.publicSlug ?? null,
    responseSearchMode: DEFAULT_SEARCH_MODE,
    resultCount: 0,
    resultSource,
    routeLanguageSlug,
    ...languageAttributes,
    searchRequestId: analytics.searchRequestId,
    surface: analytics.surface,
    visibleResultCount: safeNonNegativeInt(analytics.visibleResultCount),
    watchContext: null,
  })
}

function isWatchSearchAnalyticsSurface(
  analytics: WatchSearchAnalyticsInput | undefined,
): analytics is WatchSearchAnalyticsInput & {
  surface: typeof WATCH_SEARCH_ANALYTICS_SURFACE
} {
  return analytics?.surface === WATCH_SEARCH_ANALYTICS_SURFACE
}

function normalizeAnalyticsRequestType(
  requestType: WatchSearchRequestType | null | undefined,
): WatchSearchRequestType {
  return requestType === "load_more" ? "load_more" : "search"
}

function failureCategoryForResultSource(
  resultSource: SearchActionResultSource,
): WatchSearchFailureCategory {
  return resultSource === "algolia" ? "algolia_error" : "semantic_error"
}

function safeNonNegativeInt(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function trustedSearchLanguageAttributes({
  languageOptions,
  selectedLanguageEnglishNames,
  languageSlug,
}: {
  languageOptions: readonly SearchLanguageOption[]
  selectedLanguageEnglishNames: readonly string[]
  languageSlug?: string | null
}): {
  searchLanguageEnglishName?: string | null
  searchLanguageSlug?: string | null
} {
  const selectedLanguageEnglishName = selectedLanguageEnglishNames[0] ?? null
  const selectedOption = selectedLanguageEnglishName
    ? findSearchLanguageOptionByEnglishName(
        selectedLanguageEnglishName,
        languageOptions,
      )
    : null

  if (selectedOption) {
    return {
      searchLanguageEnglishName: selectedOption.englishName,
      searchLanguageSlug: selectedOption.publicSlug,
    }
  }

  const explicitSlug =
    typeof languageSlug === "string" && isPublicWatchLanguageSlug(languageSlug)
      ? languageSlug
      : null

  return explicitSlug ? { searchLanguageSlug: explicitSlug } : {}
}

function safeScheduleWatchSearchAnalyticsEvent(
  input: Parameters<typeof scheduleWatchSearchAnalyticsEvent>[0],
): void {
  try {
    scheduleWatchSearchAnalyticsEvent(input)
  } catch {
    // Search analytics is intentionally best-effort and non-blocking.
  }
}

function withResolvedLanguageSlug(
  results: readonly SearchResult[],
  resolvedLanguage: { publicSlug: string },
): SearchResult[] {
  if (!isPublicWatchLanguageSlug(resolvedLanguage.publicSlug)) {
    return [...results]
  }
  return results.map((result) =>
    result.type === "video"
      ? {
          ...result,
          languageSlug: result.languageSlug ?? resolvedLanguage.publicSlug,
        }
      : result,
  )
}

async function readAcceptLanguageHeader(): Promise<string | null> {
  try {
    const requestHeaders = await headers()
    return requestHeaders.get("accept-language")
  } catch {
    return null
  }
}

function preferredSearchLanguage({
  languageEnglishNames,
  languageOptions,
  resolvedLanguage,
}: {
  languageEnglishNames: readonly string[]
  languageOptions: readonly SearchLanguageOption[]
  resolvedLanguage: { publicSlug: string; englishName: string | null }
}): SearchLanguageOption | null {
  const selectedLanguage = languageEnglishNames[0]
    ? findSearchLanguageOptionByEnglishName(
        languageEnglishNames[0],
        languageOptions,
      )
    : null
  if (selectedLanguage) return selectedLanguage

  const resolvedOption = languageOptions.find(
    (option) => option.publicSlug === resolvedLanguage.publicSlug,
  )
  if (resolvedOption) return resolvedOption

  if (!resolvedLanguage.englishName) {
    return {
      coreId: null,
      englishName: "English",
      nativeName: null,
      bcp47: "en",
      publicSlug: resolvedLanguage.publicSlug,
      regionNames: [],
    }
  }

  return {
    coreId: null,
    englishName: resolvedLanguage.englishName,
    nativeName: null,
    bcp47: null,
    publicSlug: resolvedLanguage.publicSlug,
    regionNames: [],
  }
}

function normalizeSearchError(error: unknown): SearchError {
  if (error != null) {
    console.error(
      `[watch-search][semantic] ${sanitizeErrorMessage(errorMessage(error))}`,
    )
  }

  const retryAfterSeconds =
    error && typeof error === "object" && "retryAfterSeconds" in error
      ? (error as Partial<SearchError>).retryAfterSeconds
      : undefined
  const safeRetryAfterSeconds =
    typeof retryAfterSeconds === "number" &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
      ? Math.floor(retryAfterSeconds)
      : undefined

  const safeError: SearchError = {
    code: "SEARCH_ERROR",
    message: "Search request failed",
  }
  if (safeRetryAfterSeconds != null) {
    safeError.retryAfterSeconds = safeRetryAfterSeconds
  }
  return safeError
}

function sanitizeErrorMessage(message: string): string {
  const stripped = message.replace(/[\r\n\t]/g, " ")
  return stripped.length > 200 ? `${stripped.slice(0, 200)}...` : stripped
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "unknown error"
  }
}
