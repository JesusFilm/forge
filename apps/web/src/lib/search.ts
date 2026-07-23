import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import { semanticSearchAdminClient } from "@/lib/admin-client"
import {
  publicSlugForLocale,
  type SearchLanguageResolution,
} from "./search-language"

export type SearchContentType = "video" | "experience"
export type SearchAvailabilityKind =
  | "target_audio"
  | "target_subtitle"
  | "related_language"
  | "unavailable"

export type SearchLaneStatus = {
  lane: string
  status: string
  elapsedMs: number
  resultCount: number
  reason: string | null
}

export type AdminVideoLabel =
  | "BEHIND_THE_SCENES"
  | "COLLECTION"
  | "EPISODE"
  | "FEATURE_FILM"
  | "SEGMENT"
  | "SERIES"
  | "SHORT_FILM"
  | "TRAILER"

export type SearchResult = {
  type: SearchContentType
  id: string
  slug: string
  title: string
  imageUrl: string | null
  imageBlurDataUrl: string | null
  muxThumbnailBlurDataUrl: string | null
  snippet: string
  startSeconds: number | null
  playbackId: string | null
  score: number
  /** Admin VideoLabel for video results; null when type === "experience". */
  label: AdminVideoLabel | null
  /** Primary playable dub duration in seconds; null for experiences and
   *  videos without a playable dub (e.g. a series whose runtime lives on
   *  its child episodes). Drives the duration pill on singular videos. */
  durationSeconds: number | null
  /** Count of child videos (parent_id === this video). null for
   *  experiences; 0 when a video has no children. Drives the
   *  "{n} episodes" pill on series / collection cards. */
  childCount: number | null
  /** Search surface that produced this row. */
  source?: "watch-search"
  /** Public Watch audio-language slug to prefer for result links. */
  languageSlug?: string | null
  /** English language label returned by Admin for the resolved result language. */
  languageEnglishName?: string | null
  /** Admin-owned watchability classification for this result. */
  availabilityKind?: SearchAvailabilityKind | null
  /** Human-readable availability language label, e.g. Russian. */
  availabilityLanguageEnglishName?: string | null
  /** Safe evidence label, e.g. Title match. */
  evidenceLabel?: string | null
  /** Language slug for the evidence source, when Admin can identify it. */
  evidenceLanguageSlug?: string | null
}

export type SearchError = {
  code: string
  message: string
  retryAfterSeconds?: number
}

export type SearchResponse = {
  results: SearchResult[]
  hasMore: boolean
  query: string
  searchMode: string
  latencyMs: number
  nextOffset?: number
  requestId?: string | null
  degraded?: boolean
  laneStatuses?: SearchLaneStatus[]
}

export type SearchVideosLanguageContext = {
  clientRequestId?: string | null
  targetLanguageSlug?: string | null
  queryLanguageSlug?: string | null
  queryNamedLanguageSlug?: string | null
  displayLanguageSlug?: string | null
  routeLanguageSlug?: string | null
  currentWatchLanguageSlug?: string | null
  acceptLanguage?: string | null
}

export type SearchActionResultSource = "watch-search"

export type SearchActionResult =
  | (SearchResponse & {
      ok: true
      resultSource: SearchActionResultSource
      resolvedLanguage: SearchLanguageResolution
      languageFacets?: Record<string, number>
    })
  | (Omit<SearchResponse, "results" | "hasMore"> & {
      ok: false
      results: []
      hasMore: false
      resultSource: SearchActionResultSource
      resolvedLanguage: SearchLanguageResolution
      languageFacets?: Record<string, number>
      error: SearchError
    })

const MAX_QUERY_LENGTH = 200

const watchSearchOperation = adminGraphql(`
  query WatchSearch($input: WatchSearchInput!) {
    watchSearch(input: $input) {
      requestId
      query
      degraded
      laneStatuses {
        lane
        status
        elapsedMs
        resultCount
        reason
      }
      results {
        type
        id
        slug
        title
        imageUrl
        imageBlurDataUrl
        muxThumbnailBlurDataUrl
        snippet
        playbackId
        startSeconds
        score
        label
        durationSeconds
        childCount
        languageSlug
        languageEnglishName
        availability {
          kind
          languageEnglishName
        }
        evidence {
          label
          languageSlug
        }
        action {
          hrefLanguageSlug
        }
      }
      hasMore
      searchMode
      latencyMs
      nextOffset
    }
  }
`)

type WatchSearchResult = AdminResultOf<
  typeof watchSearchOperation
>["watchSearch"]

type WatchSearchResultItem = NonNullable<
  NonNullable<WatchSearchResult>["results"]
>[number]

function toWatchSearchResultType(
  type?: SearchContentType,
): Array<"VIDEO" | "EXPERIENCE"> | undefined {
  if (type === "video") return ["VIDEO"]
  if (type === "experience") return ["EXPERIENCE"]
  return undefined
}

function mapWatchSearchResult(
  result: WatchSearchResultItem,
): SearchResult | null {
  if (!result.type || !result.id || !result.slug || !result.title) {
    return null
  }

  return {
    type: result.type.toLowerCase() as SearchContentType,
    id: result.id,
    slug: result.slug,
    title: result.title,
    imageUrl: result.imageUrl,
    imageBlurDataUrl: result.imageBlurDataUrl,
    muxThumbnailBlurDataUrl: result.muxThumbnailBlurDataUrl,
    snippet: htmlToPlainText(result.snippet),
    startSeconds: result.startSeconds,
    playbackId: result.playbackId,
    score: result.score ?? 0,
    label: result.label as AdminVideoLabel | null,
    durationSeconds: result.durationSeconds,
    childCount: result.childCount,
    source: "watch-search",
    languageSlug: result.action?.hrefLanguageSlug ?? result.languageSlug,
    languageEnglishName: result.languageEnglishName,
    availabilityKind: mapWatchSearchAvailabilityKind(result.availability?.kind),
    availabilityLanguageEnglishName:
      result.availability?.languageEnglishName ?? result.languageEnglishName,
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

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(normalized, "text/html")
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim()
  }

  return normalized
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function mapWatchSearchAvailabilityKind(
  kind:
    | NonNullable<WatchSearchResultItem["availability"]>["kind"]
    | null
    | undefined,
): SearchAvailabilityKind | null {
  if (kind === "TARGET_AUDIO") return "target_audio"
  if (kind === "TARGET_SUBTITLE") return "target_subtitle"
  if (kind === "RELATED_LANGUAGE") return "related_language"
  if (kind === "UNAVAILABLE") return "unavailable"
  return null
}

export async function searchVideos(
  query: string,
  limit = 20,
  offset = 0,
  type?: SearchContentType,
  locale = "en",
  languageContext: SearchVideosLanguageContext = {},
): Promise<SearchResponse> {
  const truncatedQuery = query.slice(0, MAX_QUERY_LENGTH)
  const result = await semanticSearchAdminClient.query({
    query: watchSearchOperation,
    variables: {
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
        resultTypes: toWatchSearchResultType(type),
      },
    },
    fetchPolicy: "no-cache",
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  const response = result.data?.watchSearch
  if (!response) {
    throw new Error("Watch search response was empty")
  }

  return {
    results: (response.results ?? []).flatMap((item) => {
      const mapped = mapWatchSearchResult(item)
      return mapped ? [mapped] : []
    }),
    hasMore: response.hasMore ?? false,
    query: response.query ?? truncatedQuery,
    searchMode: response.searchMode ?? "watch-search",
    latencyMs: response.latencyMs ?? 0,
    nextOffset: response.nextOffset ?? offset,
    requestId: response.requestId ?? null,
    degraded: response.degraded ?? false,
    laneStatuses: (response.laneStatuses ?? []).map((status) => ({
      lane: status.lane ?? "unknown",
      status: status.status ?? "unknown",
      elapsedMs: status.elapsedMs ?? 0,
      resultCount: status.resultCount ?? 0,
      reason: status.reason ?? null,
    })),
  }
}
