"use server"

import { adminGraphql, type AdminVariablesOf } from "@forge/admin-graphql"
import { headers } from "next/headers"

import adminClient from "@/lib/admin-client"
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
  findQueryNamedLanguageOption,
  findSearchLanguageOptionByEnglishName,
  normalizeSearchLanguageEnglishNames,
  publicSlugForLocale,
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
import { getSearchLanguageOptions } from "./search-language-actions"

// Server-action wrapper around `searchVideos` for client-component callers.
// The "use server" directive limits this file to exporting async functions only;
// the type for the action shape itself lives in search.ts.

const DEFAULT_SEARCH_MODE = "watch-search"
const DEFAULT_SEMANTIC_CONTENT_TYPE: SearchContentType = "video"

const recordWatchSearchEventOperation = adminGraphql(`
  mutation RecordWatchSearchEvent(
    $requestId: String!
    $eventType: WatchSearchEventType!
    $client: WatchSearchEventClient!
    $resultId: ID
    $resultType: WatchSearchEventResultType
    $position: Int
    $visibleResultIds: [String!]
    $routeLanguageSlug: String
    $searchLanguageSlug: String
    $occurredAt: String
  ) {
    recordWatchSearchEvent(
      requestId: $requestId
      eventType: $eventType
      client: $client
      resultId: $resultId
      resultType: $resultType
      position: $position
      visibleResultIds: $visibleResultIds
      routeLanguageSlug: $routeLanguageSlug
      searchLanguageSlug: $searchLanguageSlug
      occurredAt: $occurredAt
    ) {
      id
    }
  }
`)

type RecordWatchSearchEventVariables = AdminVariablesOf<
  typeof recordWatchSearchEventOperation
>

export type RecordWatchSearchResultClickInput = {
  requestId: string
  resultId: string
  resultType: SearchContentType
  position: number
  visibleResultIds?: string[]
  routeLanguageSlug?: string | null
  searchLanguageSlug?: string | null
}

export type RecordWatchSearchResultsViewedInput = {
  requestId: string
  visibleResultIds: string[]
  routeLanguageSlug?: string | null
  searchLanguageSlug?: string | null
}

export async function runSearch(input: {
  analytics?: WatchSearchAnalyticsInput
  query: string
  limit?: number
  offset?: number
  type?: SearchContentType
  languageEnglishNames?: string[]
  languageOptions?: SearchLanguageOption[]
  languageSlug?: string | null
  languageSlugIsExplicit?: boolean
  routeLanguageSlug?: string | null
  uiLocale?: string
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
    languageSlugIsExplicit,
    routeLanguageSlug,
    uiLocale = "en",
  } = input

  const truncatedQuery = query.slice(0, 200)
  const validatedRouteLanguageSlug =
    routeLanguageSlug == null || isPublicWatchLanguageSlug(routeLanguageSlug)
      ? routeLanguageSlug
      : null
  const displayLanguageSlug = publicSlugForLocale(uiLocale)
  const startedAt = performance.now()
  let effectiveLanguageOptions: readonly SearchLanguageOption[] =
    languageOptions
  let resolvedLanguageForAnalytics:
    | SearchActionResult["resolvedLanguage"]
    | null = null
  let attemptedResultSource: SearchActionResultSource | null = null
  const selectedLanguageEnglishNames =
    normalizeSearchLanguageEnglishNames(languageEnglishNames)

  try {
    const acceptLanguage = await readAcceptLanguageHeader()
    effectiveLanguageOptions =
      await loadLanguageOptionsIfNeeded(languageOptions)
    const queryNamedLanguage = findQueryNamedLanguageOption(
      truncatedQuery,
      effectiveLanguageOptions,
    )

    const resolvedLanguage = resolveSearchLanguage({
      selectedEnglishNames: selectedLanguageEnglishNames,
      explicitSlug: languageSlug,
      routeLanguageSlug: validatedRouteLanguageSlug,
      acceptLanguage,
      languageOptions: effectiveLanguageOptions,
    })
    resolvedLanguageForAnalytics = resolvedLanguage

    attemptedResultSource = "watch-search"
    try {
      const contentType = type ?? DEFAULT_SEMANTIC_CONTENT_TYPE
      const response = await searchVideos(
        truncatedQuery,
        limit,
        offset,
        contentType,
        uiLocale,
        {
          clientRequestId: analytics?.searchRequestId,
          targetLanguageSlug:
            languageSlug != null && (languageSlugIsExplicit ?? true)
              ? resolvedLanguage.publicSlug
              : null,
          queryNamedLanguageSlug: queryNamedLanguage?.publicSlug,
          displayLanguageSlug,
          routeLanguageSlug: validatedRouteLanguageSlug,
          acceptLanguage,
        },
      )
      const result: SearchActionResult = {
        ...response,
        results: withResolvedLanguageSlug(response.results, resolvedLanguage),
        ok: true,
        resultSource: "watch-search",
        resolvedLanguage,
      }
      scheduleAnalyticsForResponse({
        analytics,
        languageOptions: effectiveLanguageOptions,
        languageSlug,
        offset,
        response: result,
        routeLanguageSlug: validatedRouteLanguageSlug,
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
        resultSource: "watch-search",
        resolvedLanguage,
        error: normalizeSearchError(error),
      }
      scheduleAnalyticsForResponse({
        analytics,
        analyticsLatencyMs: performance.now() - startedAt,
        languageOptions: effectiveLanguageOptions,
        languageSlug,
        offset,
        response: result,
        routeLanguageSlug: validatedRouteLanguageSlug,
        selectedLanguageEnglishNames,
      })
      return result
    }
  } catch (error) {
    scheduleAnalyticsForUnexpectedFailure({
      analytics,
      elapsedMs: performance.now() - startedAt,
      languageOptions: effectiveLanguageOptions,
      languageSlug,
      offset,
      query: truncatedQuery,
      resolvedLanguage: resolvedLanguageForAnalytics,
      resultSource: attemptedResultSource,
      routeLanguageSlug: validatedRouteLanguageSlug,
      selectedLanguageEnglishNames,
    })
    throw error
  }
}

export async function recordWatchSearchResultClick(
  input: RecordWatchSearchResultClickInput,
): Promise<{ ok: boolean }> {
  const requestId = safeRequestId(input.requestId)
  const resultId = safeToken(input.resultId)
  if (!requestId || !resultId) return { ok: false }

  const variables = {
    requestId,
    eventType: "RESULT_CLICKED",
    client: "WEB",
    resultId,
    resultType: toWatchSearchEventResultType(input.resultType),
    position: safePositiveInt(input.position),
    visibleResultIds: safeVisibleResultIds(input.visibleResultIds ?? []),
    routeLanguageSlug: safeToken(input.routeLanguageSlug),
    searchLanguageSlug: safeToken(input.searchLanguageSlug),
    occurredAt: new Date().toISOString(),
  } satisfies RecordWatchSearchEventVariables

  try {
    await adminClient.mutate({
      mutation: recordWatchSearchEventOperation,
      variables,
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function recordWatchSearchResultsViewed(
  input: RecordWatchSearchResultsViewedInput,
): Promise<{ ok: boolean }> {
  const requestId = safeRequestId(input.requestId)
  const visibleResultIds = safeVisibleResultIds(input.visibleResultIds)
  if (!requestId || visibleResultIds.length === 0) return { ok: false }

  const variables = {
    requestId,
    eventType: "RESULTS_VIEWED",
    client: "WEB",
    resultId: null,
    resultType: null,
    position: null,
    visibleResultIds,
    routeLanguageSlug: safeToken(input.routeLanguageSlug),
    searchLanguageSlug: safeToken(input.searchLanguageSlug),
    occurredAt: new Date().toISOString(),
  } satisfies RecordWatchSearchEventVariables

  try {
    await adminClient.mutate({
      mutation: recordWatchSearchEventOperation,
      variables,
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

async function loadLanguageOptionsIfNeeded(
  languageOptions: readonly SearchLanguageOption[],
): Promise<readonly SearchLanguageOption[]> {
  if (languageOptions.length > 0) return languageOptions

  const result = await getSearchLanguageOptions()
  return result.ok ? result.options : languageOptions
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
    degraded: response.degraded,
    laneStatuses: response.laneStatuses,
    routeLanguageSlug,
    ...languageAttributes,
    searchRequestId: response.requestId ?? analytics.searchRequestId,
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
  _resultSource: SearchActionResultSource,
): WatchSearchFailureCategory {
  return "watch_search_error"
}

function safeNonNegativeInt(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function safePositiveInt(value: number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.floor(parsed)
}

function safeVisibleResultIds(value: string[]): string[] {
  return value.flatMap((id) => {
    const safe = safeToken(id)
    return safe ? [safe] : []
  })
}

function safeRequestId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || !/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return null
  return normalized
}

function safeToken(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\r\n\t]/g, " ").trim()
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    return null
  }
  return normalized.slice(0, 128)
}

function toWatchSearchEventResultType(
  type: SearchContentType,
): "VIDEO" | "EXPERIENCE" {
  return type === "experience" ? "EXPERIENCE" : "VIDEO"
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
    result.type === "video" &&
    result.availabilityKind !== "target_subtitle" &&
    result.availabilityKind !== "unavailable"
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

function normalizeSearchError(error: unknown): SearchError {
  if (error != null) {
    console.error(`[watch-search] ${sanitizeErrorMessage(errorMessage(error))}`)
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
