"use client"

import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import {
  adminWatchSearchOperation,
  adminWatchSearchQuery,
  adminWatchSearchSuggestionsOperation,
  adminWatchSearchSuggestionsQuery,
} from "@forge/admin-graphql/operations"

import { env } from "@/env"
import {
  publicSlugForLocale,
  type SearchLanguageResolution,
} from "./search-language"
import { resolveSearchResultLanguages } from "./search-result-language"
import type {
  AdminVideoLabel,
  SearchAvailabilityKind,
  SearchContentType,
  SearchResponse,
  SearchResult,
  SearchVideosLanguageContext,
} from "./search"
import { normalizeWatchSearchQuery } from "./watch-search-query"

const WATCH_SEARCH_TIMEOUT_MS = 45_000
const MAX_WATCH_SEARCH_AUTOCOMPLETE_ROWS = 12
const WATCH_SEARCH_SUGGESTIONS_TIMEOUT_MS = 3_500

type WatchSearchGraphqlResult = AdminResultOf<typeof adminWatchSearchOperation>
type WatchSearchGraphqlItem = NonNullable<
  NonNullable<WatchSearchGraphqlResult["watchSearch"]>["results"]
>[number]
type WatchSearchResultType = NonNullable<
  AdminVariablesOf<typeof adminWatchSearchOperation>["input"]["resultTypes"]
>[number]
type WatchSearchSuggestionsResult = AdminResultOf<
  typeof adminWatchSearchSuggestionsOperation
>

type GraphqlResponse<TData> = {
  data?: TData
  errors?: Array<{
    message?: string | null
    extensions?: {
      code?: unknown
      http?: { statusCode?: unknown }
    }
  }>
}

export type WatchSearchErrorKind =
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unknown"

export class WatchSearchRequestError extends Error {
  constructor(
    message: string,
    readonly kind: WatchSearchErrorKind,
  ) {
    super(message)
    this.name = "WatchSearchRequestError"
  }
}

export function watchSearchErrorKind(error: unknown): WatchSearchErrorKind {
  return error instanceof WatchSearchRequestError ? error.kind : "unknown"
}

function watchSearchStatusErrorKind(status: unknown): WatchSearchErrorKind {
  if (status === 429) return "rate_limited"
  if (typeof status === "number" && status >= 500) return "server_error"
  return "unknown"
}

function watchSearchGraphqlErrorKind(
  error: NonNullable<GraphqlResponse<unknown>["errors"]>[number],
): WatchSearchErrorKind {
  const statusKind = watchSearchStatusErrorKind(
    error.extensions?.http?.statusCode,
  )
  if (statusKind !== "unknown") return statusKind
  return error.extensions?.code === "INTERNAL_SERVER_ERROR"
    ? "server_error"
    : "unknown"
}

function watchSearchFetchErrorKind(error: unknown): WatchSearchErrorKind {
  const name =
    typeof error === "object" && error != null && "name" in error
      ? error.name
      : null
  return name === "TimeoutError" || name === "AbortError"
    ? "server_error"
    : "network_error"
}

export type DirectWatchSearchInput = {
  query: string
  limit?: number
  offset?: number
  type?: SearchContentType
  locale?: string
  languageContext?: SearchVideosLanguageContext
  resolvedLanguage?: SearchLanguageResolution
}

export type FetchWatchSearchSuggestionsInput = {
  query: string
  languageSlug: string
  signal?: AbortSignal
  timeoutMs?: number
}

export type WatchSearchSuggestion = {
  kind: "query" | "content"
  title: string
  description: string | null
  matchSource: "title" | "description"
  id: string | null
  slug: string | null
  label: AdminVideoLabel | null
  childCount: number | null
}

export class WatchSearchSuggestionsError extends Error {
  constructor(
    message: string,
    readonly code: "http" | "graphql" | "malformed_response",
  ) {
    super(message)
    this.name = "WatchSearchSuggestionsError"
  }
}

function parseSuggestions(value: unknown): WatchSearchSuggestion[] {
  if (!Array.isArray(value)) {
    throw new WatchSearchSuggestionsError(
      "Watch search suggestion response was empty",
      "malformed_response",
    )
  }

  const seen = new Set<string>()
  const suggestions: WatchSearchSuggestion[] = []
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item == null ||
      !("kind" in item) ||
      (item.kind !== "QUERY" && item.kind !== "CONTENT") ||
      !("title" in item) ||
      typeof item.title !== "string" ||
      !("description" in item) ||
      (item.description != null && typeof item.description !== "string") ||
      !("matchSource" in item) ||
      (item.matchSource !== "TITLE" && item.matchSource !== "DESCRIPTION") ||
      !("id" in item) ||
      (item.id != null && typeof item.id !== "string") ||
      !("slug" in item) ||
      (item.slug != null && typeof item.slug !== "string") ||
      !("label" in item) ||
      (item.label != null &&
        ![
          "BEHIND_THE_SCENES",
          "COLLECTION",
          "EPISODE",
          "FEATURE_FILM",
          "SEGMENT",
          "SERIES",
          "SHORT_FILM",
          "TRAILER",
        ].includes(item.label as string)) ||
      !("childCount" in item) ||
      (item.childCount != null && typeof item.childCount !== "number")
    ) {
      throw new WatchSearchSuggestionsError(
        "Watch search suggestion response was malformed",
        "malformed_response",
      )
    }
    const title = item.title.trim()
    if (!title) continue
    if (
      item.kind === "CONTENT" &&
      (typeof item.id !== "string" || typeof item.slug !== "string")
    ) {
      throw new WatchSearchSuggestionsError(
        "Watch search direct match was malformed",
        "malformed_response",
      )
    }
    const key = `${item.kind}:${title.normalize("NFC").toLocaleLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const description = item.description?.trim() || null
    suggestions.push({
      kind: item.kind === "CONTENT" ? "content" : "query",
      title,
      description,
      matchSource: item.matchSource === "DESCRIPTION" ? "description" : "title",
      id: item.id,
      slug: item.slug,
      label: item.label as AdminVideoLabel | null,
      childCount: item.childCount,
    })
    if (suggestions.length === MAX_WATCH_SEARCH_AUTOCOMPLETE_ROWS) break
  }
  return suggestions
}

export async function fetchWatchSearchSuggestions({
  query,
  languageSlug,
  signal,
  timeoutMs = WATCH_SEARCH_SUGGESTIONS_TIMEOUT_MS,
}: FetchWatchSearchSuggestionsInput): Promise<WatchSearchSuggestion[]> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const variables: AdminVariablesOf<
    typeof adminWatchSearchSuggestionsOperation
  > = {
    input: {
      query: normalizeWatchSearchQuery(query),
      languageSlug,
    },
  }

  try {
    const response = await fetch(env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: adminWatchSearchSuggestionsQuery,
        variables,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new WatchSearchSuggestionsError(
        `Watch search suggestions failed with HTTP ${response.status}`,
        "http",
      )
    }

    const payload =
      (await response.json()) as GraphqlResponse<WatchSearchSuggestionsResult>
    if (payload.errors?.length) {
      throw new WatchSearchSuggestionsError(
        payload.errors[0]?.message ?? "Watch search suggestions failed",
        "graphql",
      )
    }
    return parseSuggestions(payload.data?.watchSearchSuggestions)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}

export async function searchWatchDirect({
  query,
  limit = 20,
  offset = 0,
  type,
  locale = "en",
  languageContext = {},
  resolvedLanguage,
}: DirectWatchSearchInput): Promise<SearchResponse> {
  const truncatedQuery = normalizeWatchSearchQuery(query)
  const resultTypes = toWatchSearchResultType(type)
  const variables: AdminVariablesOf<typeof adminWatchSearchOperation> = {
    input: {
      query: truncatedQuery,
      clientRequestId: languageContext.clientRequestId,
      targetLanguageSlug: languageContext.targetLanguageSlug,
      queryLanguageSlug: languageContext.queryLanguageSlug,
      queryNamedLanguageSlug: languageContext.queryNamedLanguageSlug,
      displayLanguageSlug:
        languageContext.displayLanguageSlug ?? publicSlugForLocale(locale),
      routeLanguageSlug: languageContext.routeLanguageSlug,
      currentWatchLanguageSlug: languageContext.currentWatchLanguageSlug,
      acceptLanguage: languageContext.acceptLanguage,
      limit,
      offset,
      resultTypes,
    },
  }
  let response: Response
  try {
    response = await fetch(env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: adminWatchSearchQuery,
        variables,
      }),
      signal: timeoutSignal(WATCH_SEARCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new WatchSearchRequestError(
      "Watch search request failed",
      watchSearchFetchErrorKind(error),
    )
  }

  if (!response.ok) {
    throw new WatchSearchRequestError(
      `Watch search failed with HTTP ${response.status}`,
      watchSearchStatusErrorKind(response.status),
    )
  }

  const payload =
    (await response.json()) as GraphqlResponse<WatchSearchGraphqlResult>
  if (payload.errors?.length) {
    const error = payload.errors[0]!
    throw new WatchSearchRequestError(
      error.message ?? "Watch search failed",
      watchSearchGraphqlErrorKind(error),
    )
  }

  const watchSearch = payload.data?.watchSearch
  if (!watchSearch) {
    throw new Error("Watch search response was empty")
  }

  const results = (watchSearch.results ?? []).flatMap((item) => {
    const mapped = mapWatchSearchResult(item)
    if (!mapped) return []
    if (!resolvedLanguage) return [mapped]
    return [withResolvedLanguageSlug(mapped, resolvedLanguage)]
  })

  return {
    results,
    hasMore: watchSearch.hasMore ?? false,
    query: watchSearch.query ?? truncatedQuery,
    searchMode: watchSearch.searchMode ?? "watch-search",
    latencyMs: watchSearch.latencyMs ?? 0,
    targetLanguageSlug:
      watchSearch.languageInterpretation?.targetLanguageSlug ?? null,
    nextOffset: watchSearch.nextOffset ?? offset,
    requestId: watchSearch.requestId ?? null,
    degraded: watchSearch.degraded ?? false,
    laneStatuses: (watchSearch.laneStatuses ?? []).map((status) => ({
      lane: status.lane ?? "unknown",
      status: status.status ?? "unknown",
      elapsedMs: status.elapsedMs ?? 0,
      resultCount: status.resultCount ?? 0,
      reason: status.reason ?? null,
    })),
  }
}

function toWatchSearchResultType(
  type?: SearchContentType,
): WatchSearchResultType[] | undefined {
  if (type === "video") return ["VIDEO"]
  if (type === "experience") return ["EXPERIENCE"]
  return undefined
}

function mapWatchSearchResult(
  result: WatchSearchGraphqlItem,
): SearchResult | null {
  if (!result.type || !result.id || !result.slug || !result.title) {
    return null
  }

  const availabilityKind = mapWatchSearchAvailabilityKind(
    result.availability?.kind,
  )
  const resultLanguages = resolveSearchResultLanguages({
    availabilityKind,
    resultLanguageSlug: result.languageSlug,
    resultLanguageEnglishName: result.languageEnglishName,
    actionLanguageSlug: result.action?.hrefLanguageSlug,
    availabilityLanguageSlug: result.availability?.languageSlug,
    availabilityLanguageEnglishName: result.availability?.languageEnglishName,
  })

  return {
    type: result.type.toLowerCase() as SearchContentType,
    id: result.id,
    slug: result.slug,
    title: result.title,
    imageUrl: result.imageUrl ?? null,
    imageBlurDataUrl: result.imageBlurDataUrl ?? null,
    muxThumbnailBlurDataUrl: result.muxThumbnailBlurDataUrl ?? null,
    snippet: htmlToPlainText(result.snippet),
    startSeconds: result.startSeconds ?? null,
    playbackId: result.playbackId ?? null,
    score: result.score ?? 0,
    label: (result.label as AdminVideoLabel | null) ?? null,
    durationSeconds: result.durationSeconds ?? null,
    childCount: result.childCount ?? null,
    source: "watch-search",
    languageSlug: resultLanguages.languageSlug,
    languageEnglishName: resultLanguages.languageEnglishName,
    availabilityKind,
    subtitleLanguageSlug: resultLanguages.subtitleLanguageSlug,
    availabilityLanguageEnglishName:
      resultLanguages.availabilityLanguageEnglishName,
    evidenceLabel: result.evidence?.label ?? null,
    evidenceLanguageSlug: result.evidence?.languageSlug ?? null,
  }
}

function htmlToPlainText(value: string | null | undefined): string {
  if (!value) return ""
  const normalized = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) return ""

  const doc = new DOMParser().parseFromString(normalized, "text/html")
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim()
}

function mapWatchSearchAvailabilityKind(
  kind: string | null | undefined,
): SearchAvailabilityKind | null {
  if (kind === "TARGET_AUDIO") return "target_audio"
  if (kind === "TARGET_SUBTITLE") return "target_subtitle"
  if (kind === "RELATED_LANGUAGE") return "related_language"
  if (kind === "CONTAINER") return "container"
  if (kind === "UNAVAILABLE") return "unavailable"
  return null
}

function withResolvedLanguageSlug(
  result: SearchResult,
  resolvedLanguage: SearchLanguageResolution,
): SearchResult {
  if (
    result.type !== "video" ||
    result.availabilityKind === "target_subtitle" ||
    result.availabilityKind === "unavailable"
  ) {
    return result
  }
  return {
    ...result,
    languageSlug: result.languageSlug ?? resolvedLanguage.publicSlug,
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") return undefined
  const timeout = (
    AbortSignal as typeof AbortSignal & {
      timeout?: (milliseconds: number) => AbortSignal
    }
  ).timeout
  if (timeout) return timeout(timeoutMs)

  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}
