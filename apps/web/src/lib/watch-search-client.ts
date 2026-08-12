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
const MAX_WATCH_SEARCH_SUGGESTIONS = 5
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
  errors?: Array<{ message?: string | null }>
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
  title: string
  description: string | null
  matchSource: "title" | "description"
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
      !("title" in item) ||
      typeof item.title !== "string" ||
      !("description" in item) ||
      (item.description != null && typeof item.description !== "string") ||
      !("matchSource" in item) ||
      (item.matchSource !== "TITLE" && item.matchSource !== "DESCRIPTION")
    ) {
      throw new WatchSearchSuggestionsError(
        "Watch search suggestion response was malformed",
        "malformed_response",
      )
    }
    const title = item.title.trim()
    if (!title) continue
    const key = title.normalize("NFC").toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const description = item.description?.trim() || null
    suggestions.push({
      title,
      description,
      matchSource: item.matchSource === "DESCRIPTION" ? "description" : "title",
    })
    if (suggestions.length === MAX_WATCH_SEARCH_SUGGESTIONS) break
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
  const response = await fetch(env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL, {
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

  if (!response.ok) {
    throw new Error(`Watch search failed with HTTP ${response.status}`)
  }

  const payload =
    (await response.json()) as GraphqlResponse<WatchSearchGraphqlResult>
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? "Watch search failed")
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
  if (kind === "UNAVAILABLE") return "unavailable"
  return null
}

function withResolvedLanguageSlug(
  result: SearchResult,
  resolvedLanguage: SearchLanguageResolution,
): SearchResult {
  if (
    result.type !== "video" ||
    result.availabilityKind === "target_subtitle"
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
