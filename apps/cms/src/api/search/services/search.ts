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
  startSeconds: number
  playbackId: string
  score: number
}

export type SearchResponse = {
  results: SearchResult[]
  total: number
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
 * startSeconds, playbackId). Keyword-only results fall back to
 * video description and zero startSeconds.
 */
function mapToSearchResult(result: FusedResult): SearchResult {
  return {
    type: "video",
    id: result.videoId,
    slug: (result.videoSlug as string) ?? "",
    title: result.videoTitle ?? "",
    imageUrl: (result.imageUrl as string | null) ?? null,
    snippet: (result.description as string) ?? "",
    startSeconds: (result.startSeconds as number) ?? 0,
    playbackId: (result.playbackId as string) ?? "",
    score: Math.round(result.score * 1000) / 1000,
  }
}

/**
 * Hybrid search orchestrator.
 *
 * 1. Embed the user's query via OpenRouter (~200ms)
 * 2. Run semantic (pgvector) and keyword (tsvector) retrieval in parallel
 * 3. Merge via Reciprocal Rank Fusion
 * 4. Deduplicate (3-layer: core_id, title, embedding similarity)
 * 5. Paginate and map to API contract
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

  // Step 1: Embed the user's query
  const queryVector = await embedQuery(query)
  const queryEmbedding = toPgvectorText(queryVector)

  // Step 2: Run semantic + keyword retrieval in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    searchBySemantic(knex, {
      queryEmbedding,
      locale,
      limit: overfetchLimit,
    }),
    searchByKeyword(knex, {
      query,
      locale,
      limit: overfetchLimit,
    }),
  ])

  // Step 3: Fuse ranked lists via RRF
  const fused = fuseRankedLists([semanticResults, keywordResults], RRF_K)

  // Step 4: Deduplicate — need enough for offset + limit
  const deduped = deduplicateResults(fused, offset + limit)

  // Step 5: Paginate and map to API contract
  const page = deduped.slice(offset, offset + limit)
  const results = page.map(mapToSearchResult)

  return {
    results,
    total: deduped.length,
    query,
  }
}
