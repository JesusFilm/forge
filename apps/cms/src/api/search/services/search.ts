import type { Core } from "@strapi/strapi"
import { embedQuery } from "../../../lib/openrouter"
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { searchByKeyword } from "./keyword-search"
import { searchBySemantic } from "./semantic-search"
import { fuseRankedLists, deduplicateResults } from "./fusion"
import type { FusedResult, RankedItem } from "./fusion"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const OVERFETCH_FACTOR = 3
const RRF_K = 60

export type ContentType = "video" | "experience"

export const ALL_CONTENT_TYPES: readonly ContentType[] = ["video", "experience"]

/**
 * Type guard for the optional `type` query/argument value at the API
 * boundary. Lives here (alongside `ContentType`) so REST and GraphQL share
 * a single source of truth — adding a new content type only requires
 * updating the union and this array.
 */
export function isContentType(value: string): value is ContentType {
  return (ALL_CONTENT_TYPES as readonly string[]).includes(value)
}

export type SearchParams = {
  query: string
  locale: string
  limit?: number
  offset?: number
  /**
   * Restrict results to the given content types. Omit (or pass undefined)
   * to search both videos and experiences. Passing an empty array also
   * defaults to both, since "no results" is rarely the caller's intent.
   */
  contentTypes?: ContentType[]
}

export type SearchResult = {
  type: ContentType
  id: number
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  /** null when the match is keyword-only or for non-video results */
  startSeconds: number | null
  /** null when the match is keyword-only or for non-video results */
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
 * Video results carry scene-level data (description as snippet, startSeconds,
 * playbackId for semantic matches; nullable for keyword-only matches).
 * Experience results carry experience-level data (meta_description as
 * snippet) and always have null startSeconds/playbackId. Clients must
 * check for null before constructing a Mux deep-link URL or rendering a
 * scene thumbnail.
 */
function mapToSearchResult(result: FusedResult): SearchResult {
  if (result.resultType === "experience") {
    return {
      type: "experience",
      id: result.resultId,
      slug: (result.experienceSlug as string) ?? "",
      title: (result.experienceTitle as string) ?? "",
      imageUrl: (result.imageUrl as string | null) ?? null,
      snippet: (result.experienceMetaDescription as string | null) ?? "",
      startSeconds: null,
      playbackId: null,
      score: Math.round(result.score * 1000) / 1000,
    }
  }

  const startSeconds = result.startSeconds
  const playbackId = result.playbackId
  return {
    type: "video",
    id: result.resultId,
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
 * Annotates a video search result (from semantic-search.ts or keyword-search.ts)
 * with the compound identity key required by the fusion layer. This keeps
 * the existing video search functions agnostic of the multi-type result
 * model — the orchestrator owns the wiring.
 */
function annotateVideo<T extends { videoId: number }>(item: T): T & RankedItem {
  return {
    ...item,
    resultType: "video",
    resultId: item.videoId,
  }
}

/**
 * Hybrid search orchestrator.
 *
 * 1. Embed the user's query via OpenRouter. On failure, degrade to
 *    keyword-only search instead of returning 503 — keyword search has
 *    no external dependencies and is valuable on its own.
 * 2. Run retrieval in parallel based on `contentTypes` — up to 4 lists
 *    (video semantic, video keyword, experience semantic, experience
 *    keyword) via Promise.allSettled, so one retrieval failing does not
 *    discard the others.
 * 3. Merge via Reciprocal Rank Fusion. Empty result lists are filtered
 *    out before fusion — passing them dilutes the RRF normalization
 *    (which divides by N for N input lists).
 * 4. Deduplicate (3-layer for videos; experiences pass through).
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

  // Resolve which content types to search. Empty array falls back to all
  // types (no caller realistically wants "search nothing").
  const requested =
    params.contentTypes != null && params.contentTypes.length > 0
      ? params.contentTypes
      : ALL_CONTENT_TYPES
  const wantsVideos = requested.includes("video")
  const wantsExperiences = requested.includes("experience")

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
  // Each retrieval is paired with a label so we can map outcomes back to
  // their source for logging.
  type Retrieval = {
    label: string
    promise: Promise<RankedItem[]>
  }
  const retrievals: Retrieval[] = []

  if (wantsVideos) {
    retrievals.push({
      label: "semantic-video",
      promise:
        queryEmbedding != null
          ? searchBySemantic(knex, {
              queryEmbedding,
              locale,
              limit: overfetchLimit,
            }).then((rows) => rows.map(annotateVideo))
          : Promise.resolve([]),
    })
    retrievals.push({
      label: "keyword-video",
      promise: searchByKeyword(knex, {
        query,
        locale,
        limit: overfetchLimit,
      }).then((rows) => rows.map(annotateVideo)),
    })
  }

  if (wantsExperiences) {
    retrievals.push({
      label: "semantic-experience",
      promise:
        queryEmbedding != null
          ? searchByExperienceSemantic(knex, {
              queryEmbedding,
              locale,
              limit: overfetchLimit,
            })
          : Promise.resolve([]),
    })
    retrievals.push({
      label: "keyword-experience",
      promise: searchByExperienceKeyword(knex, {
        query,
        locale,
        limit: overfetchLimit,
      }),
    })
  }

  const outcomes = await Promise.allSettled(retrievals.map((r) => r.promise))
  const lists = outcomes.map((outcome, i) =>
    unwrapOutcome(strapi, outcome, retrievals[i]!.label),
  )

  // Step 3: Fuse ranked lists via RRF. Drop empty lists first — RRF
  // normalizes by dividing by the number of input lists, so feeding empty
  // ones dilutes scores from the lists that did contribute.
  const nonEmptyLists = lists.filter((list) => list.length > 0)
  const fused = fuseRankedLists(nonEmptyLists, RRF_K)

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
