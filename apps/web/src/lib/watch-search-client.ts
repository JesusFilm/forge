"use client"

import type { AdminResultOf, AdminVariablesOf } from "@forge/admin-graphql"
import {
  adminWatchSearchOperation,
  adminWatchSearchQuery,
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

const MAX_QUERY_LENGTH = 200
const WATCH_SEARCH_TIMEOUT_MS = 45_000

type WatchSearchGraphqlResult = AdminResultOf<typeof adminWatchSearchOperation>
type WatchSearchGraphqlItem = NonNullable<
  NonNullable<WatchSearchGraphqlResult["watchSearch"]>["results"]
>[number]
type WatchSearchResultType = NonNullable<
  AdminVariablesOf<typeof adminWatchSearchOperation>["input"]["resultTypes"]
>[number]

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

export async function searchWatchDirect({
  query,
  limit = 20,
  offset = 0,
  type,
  locale = "en",
  languageContext = {},
  resolvedLanguage,
}: DirectWatchSearchInput): Promise<SearchResponse> {
  const truncatedQuery = query.slice(0, MAX_QUERY_LENGTH)
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
