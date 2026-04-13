import type { Core } from "@strapi/strapi"
import { embedQuery } from "../../../lib/openrouter"
import { searchByKeyword } from "./keyword-search"
import { searchBySemantic } from "./semantic-search"
import { fuseRankedLists, deduplicateResults } from "./fusion"
import type { FusedResult } from "./fusion"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const OVERFETCH_FACTOR = 3
const RRF_K = 60

export type SearchParams = {
  query: string
  locale: string
  limit?: number
  offset?: number
}

export type SearchResult = {
  type: "video"
  id: number
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  /** null when the match is keyword-only (no scene-level timestamp) */
  startSeconds: number | null
  /** null when the match is keyword-only (no scene-level Mux asset) */
  playbackId: string | null
  score: number
}

export type SearchResponse = {
  results: SearchResult[]
  /** True when more results exist beyond the current page. */
  hasMore: boolean
  query: string
}

/**
 * Converts a number[] embedding vector to pgvector text format "[0.1,0.2,...]"
 */
function toPgvectorText(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Maps a fused result to the API response contract.
 *
 * Semantic results carry scene-level data (description as snippet,
 * startSeconds, playbackId). Keyword-only results fall back to the
 * video description for snippet and return null for startSeconds and
 * playbackId — clients must check for null before constructing a Mux
 * deep-link URL or rendering a scene thumbnail.
 */
function mapToSearchResult(result: FusedResult): SearchResult {
  const startSeconds = result.startSeconds
  const playbackId = result.playbackId
  return {
    type: "video",
    id: result.videoId,
    slug: (result.videoSlug as string) ?? "",
    title: result.videoTitle ?? "",
    imageUrl: (result.imageUrl as string | null) ?? null,
    snippet: (result.description as string) ?? "",
    // Null signals "no scene-level match" — keyword-only results have no
    // timestamp or playback ID. Clients must render these without deep-links.
    startSeconds: typeof startSeconds === "number" ? startSeconds : null,
    playbackId: typeof playbackId === "string" ? playbackId : null,
    score: Math.round(result.score * 1000) / 1000,
  }
}

/**
 * Hybrid search orchestrator.
 *
 * 1. Embed the user's query via OpenRouter. On failure, degrade to
 *    keyword-only search instead of returning 503 — keyword search has
 *    no external dependencies and is valuable on its own.
 * 2. Run semantic (pgvector) and keyword (tsvector) retrieval in parallel
 *    with Promise.allSettled so one retrieval failing does not discard
 *    the other's successful results.
 * 3. Merge via Reciprocal Rank Fusion (single-list fusion if semantic
 *    degraded to empty).
 * 4. Deduplicate (3-layer: core_id, title, embedding similarity).
 * 5. Paginate with hasMore signal (dedup one extra to detect overflow).
 */
export async function search(
  strapi: Core.Strapi,
  params: SearchParams,
): Promise<SearchResponse> {
  const { query, locale } = params
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const offset = Math.max(0, params.offset ?? 0)
  const knex: KnexInstance = strapi.db.connection
  const overfetchLimit = limit * OVERFETCH_FACTOR

  // Step 1: Embed the user's query. Degrade gracefully if OpenRouter is
  // unavailable — keyword search alone still returns useful results.
  let queryEmbedding: string | null = null
  try {
    const queryVector = await embedQuery(query)
    queryEmbedding = toPgvectorText(queryVector)
  } catch (error) {
    strapi.log.warn(
      `[search] Query embedding failed, falling back to keyword-only: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  // Step 2: Run retrieval in parallel. allSettled keeps partial results
  // when one retrieval fails (e.g., pgvector timeout but keyword succeeds).
  const [semanticOutcome, keywordOutcome] = await Promise.allSettled([
    queryEmbedding != null
      ? searchBySemantic(knex, {
          queryEmbedding,
          locale,
          limit: overfetchLimit,
        })
      : Promise.resolve([]),
    searchByKeyword(knex, {
      query,
      locale,
      limit: overfetchLimit,
    }),
  ])

  const semanticResults = unwrapOutcome(strapi, semanticOutcome, "semantic")
  const keywordResults = unwrapOutcome(strapi, keywordOutcome, "keyword")

  // Step 3: Fuse ranked lists via RRF
  const fused = fuseRankedLists([semanticResults, keywordResults], RRF_K)

  // Step 4: Dedup one extra result beyond the page window so we know
  // whether more results exist (drives hasMore without a full count pass).
  const deduped = deduplicateResults(fused, offset + limit + 1)

  // Step 5: Paginate and map to API contract
  const page = deduped.slice(offset, offset + limit)
  const hasMore = deduped.length > offset + limit
  const results = page.map(mapToSearchResult)

  return {
    results,
    hasMore,
    query,
  }
}

/**
 * Extracts a fulfilled value from an allSettled outcome, logging and
 * returning [] on rejection so partial failures degrade gracefully.
 */
function unwrapOutcome<T>(
  strapi: Core.Strapi,
  outcome: PromiseSettledResult<T[]>,
  label: string,
): T[] {
  if (outcome.status === "fulfilled") return outcome.value
  strapi.log.error(
    `[search] ${label} retrieval failed: ${
      outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason)
    }`,
  )
  return []
}
