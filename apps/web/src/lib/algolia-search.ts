import "server-only"

import { env } from "@/env"

import type { AlgoliaVideoHit } from "./algolia-video-transform"
import { normalizeSearchLanguageEnglishNames } from "./search-language"

export const WATCH_VISIBILITY_FILTER =
  "NOT restrictViewPlatforms:watch AND published:true AND videoPublished:true"

export type AlgoliaSearchErrorCode =
  | "ALGOLIA_NOT_CONFIGURED"
  | "ALGOLIA_UPSTREAM_ERROR"
  | "ALGOLIA_INVALID_RESPONSE"

export type AlgoliaSearchFailure = {
  ok: false
  query: string
  latencyMs: number
  error: {
    code: AlgoliaSearchErrorCode
    message: string
  }
}

export type AlgoliaSearchSuccess = {
  ok: true
  query: string
  latencyMs: number
  hits: AlgoliaVideoHit[]
  hasMore: boolean
  nbHits: number
  page: number
  offset: number
  nextOffset: number
  facets: {
    languageEnglishName: Record<string, number>
  }
}

export type AlgoliaSearchOutcome = AlgoliaSearchSuccess | AlgoliaSearchFailure

export type SearchAlgoliaVideosInput = {
  includeLanguageFacets?: boolean
  query: string
  limit?: number
  offset?: number
  languageEnglishNames?: readonly string[]
}

type AlgoliaRawResponse = {
  hits?: unknown
  nbHits?: unknown
  nbPages?: unknown
  page?: unknown
  facets?: unknown
}

const ALGOLIA_TIMEOUT_MS = 5000
const MAX_QUERY_LENGTH = 200
const MAX_LIMIT = 50

export async function searchAlgoliaVideos({
  includeLanguageFacets = true,
  query,
  limit = 20,
  offset = 0,
  languageEnglishNames = [],
}: SearchAlgoliaVideosInput): Promise<AlgoliaSearchOutcome> {
  const startedAt = performance.now()
  const truncatedQuery = query.slice(0, MAX_QUERY_LENGTH)

  const appId = env.ALGOLIA_APP_ID
  const apiKey = env.ALGOLIA_SEARCH_API_KEY
  const index = env.ALGOLIA_INDEX
  if (!appId || !apiKey || !index) {
    return failure("ALGOLIA_NOT_CONFIGURED", truncatedQuery, startedAt)
  }

  const hitsPerPage = clampLimit(limit)
  const requestOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const filters = buildWatchAlgoliaFilters(languageEnglishNames)
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-API-Key": apiKey,
        "X-Algolia-Application-Id": appId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: truncatedQuery,
        offset: requestOffset,
        length: hitsPerPage,
        filters,
        ...(includeLanguageFacets
          ? {
              facets: ["languageEnglishName"],
              maxValuesPerFacet: 1000,
            }
          : {}),
      }),
      signal: AbortSignal.timeout(ALGOLIA_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    logAlgoliaError("fetch failed", error)
    return failure("ALGOLIA_UPSTREAM_ERROR", truncatedQuery, startedAt)
  }

  if (!response.ok) {
    logAlgoliaError(`upstream status=${response.status}`)
    return failure("ALGOLIA_UPSTREAM_ERROR", truncatedQuery, startedAt)
  }

  let payload: AlgoliaRawResponse
  try {
    payload = (await response.json()) as AlgoliaRawResponse
  } catch (error) {
    logAlgoliaError("invalid json", error)
    return failure("ALGOLIA_INVALID_RESPONSE", truncatedQuery, startedAt)
  }

  if (!Array.isArray(payload.hits)) {
    logAlgoliaError("missing hits array")
    return failure("ALGOLIA_INVALID_RESPONSE", truncatedQuery, startedAt)
  }

  const nbHits = asNonNegativeInt(payload.nbHits) ?? payload.hits.length
  const page = Math.floor(requestOffset / hitsPerPage)
  const nextOffset = Math.min(nbHits, requestOffset + hitsPerPage)

  return {
    ok: true,
    query: truncatedQuery,
    latencyMs: performance.now() - startedAt,
    hits: payload.hits as AlgoliaVideoHit[],
    hasMore: nextOffset < nbHits,
    nbHits,
    page,
    offset: requestOffset,
    nextOffset,
    facets: {
      languageEnglishName: includeLanguageFacets
        ? readLanguageFacet(payload.facets)
        : {},
    },
  }
}

export function buildWatchAlgoliaFilters(
  languageEnglishNames: readonly string[] = [],
): string {
  const languageFilters =
    normalizeSearchLanguageEnglishNames(languageEnglishNames)

  if (languageFilters.length === 0) return WATCH_VISIBILITY_FILTER

  const languageExpression = languageFilters
    .map(
      (name) => `languageEnglishName:"${escapeAlgoliaFilterStringValue(name)}"`,
    )
    .join(" OR ")

  return `${WATCH_VISIBILITY_FILTER} AND (${languageExpression})`
}

function failure(
  code: AlgoliaSearchErrorCode,
  query: string,
  startedAt: number,
): AlgoliaSearchFailure {
  return {
    ok: false,
    query,
    latencyMs: performance.now() - startedAt,
    error: {
      code,
      message:
        code === "ALGOLIA_NOT_CONFIGURED"
          ? "Algolia search is not configured for this environment."
          : "Algolia search is temporarily unavailable.",
    },
  }
}

function clampLimit(limit: number): number {
  const parsed = Math.floor(Number(limit) || 20)
  return Math.max(1, Math.min(MAX_LIMIT, parsed))
}

function asNonNegativeInt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function readLanguageFacet(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {}
  const facets = value as Record<string, unknown>
  const languageFacet = facets.languageEnglishName
  if (!languageFacet || typeof languageFacet !== "object") return {}

  const result: Record<string, number> = {}
  for (const [label, count] of Object.entries(
    languageFacet as Record<string, unknown>,
  )) {
    const parsed = asNonNegativeInt(count)
    if (parsed != null) result[label] = parsed
  }
  return result
}

function escapeAlgoliaFilterStringValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function logAlgoliaError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? ` error=${sanitize(error.message)}` : ""
  console.error(`[watch-search][algolia] ${message}${detail}`)
}

function sanitize(input: string): string {
  const stripped = input.replace(/[\r\n\t]/g, " ")
  return stripped.length > 200 ? `${stripped.slice(0, 200)}...` : stripped
}
