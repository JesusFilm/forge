import type { Core } from "@strapi/strapi"
import { embedQuery } from "../../../lib/openrouter"
import { searchByExactTitle } from "./exact-title-search"
import { searchByExperienceKeyword } from "./experience-keyword-search"
import { searchByExperienceSemantic } from "./experience-semantic-search"
import { searchByKeyword } from "./keyword-search"
import { searchByKeywordWeighted } from "./keyword-weighted-search"
import { recordAttempt, recordFailure } from "./search-health"
import { searchBySemantic } from "./semantic-search"
import { searchByTrigram } from "./trigram-search"
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
  /**
   * Optional retrieval mode. Default `"hybrid"` preserves the current
   * pipeline (semantic + keyword for videos, semantic + keyword for
   * experiences). `"keyword-first"` (feat-109) opts into a 4-list lexical
   * stack on the video retrieval block: phrase-aware tsquery against a
   * weighted tsvector, plus title-trigram and exact-title retrievers.
   *
   * Nullable String, not an enum, so future modes ship as new values
   * without a schema change. Unknown values fall back to `"hybrid"` with
   * a structured warn log; never error.
   *
   * Note: this is the retrieval-mode INPUT and is orthogonal to the
   * `searchMode` field on the response, which is a degradation signal
   * (`"hybrid"` vs `"keyword-only"`) reflecting whether the embedding
   * call succeeded. The two are intentionally named differently in
   * intent — input selects the pipeline, output reflects what ran.
   */
  mode?: string | null
}

/**
 * Normalized retrieval mode used internally by `search()`. Callers pass a
 * nullable string; this is the closed set the orchestrator actually
 * branches on.
 */
export type RetrievalMode = "hybrid" | "keyword-first"

/**
 * Map a caller-supplied `mode` value onto the closed `RetrievalMode` set.
 *
 * - `null`/`undefined`/`""`/`"hybrid"` → `"hybrid"` (current behavior)
 * - `"keyword-first"` → `"keyword-first"` (new lexical stack)
 * - Anything else → `"hybrid"` plus a structured warn log so log-based
 *   alerts can catch typos without breaking the user's search.
 *
 * Exported for testing the warn-and-fallback branch in isolation.
 */
export function normalizeMode(
  strapi: Core.Strapi,
  raw: string | null | undefined,
): RetrievalMode {
  if (raw == null || raw === "" || raw === "hybrid") return "hybrid"
  if (raw === "keyword-first") return "keyword-first"
  strapi.log.warn(
    `[search] event=search_unknown_mode mode=${raw} falling_back=hybrid`,
  )
  return "hybrid"
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

/**
 * Describes which retrieval paths actually contributed to a response.
 *
 * - `"hybrid"`: the query embedding was generated successfully and semantic
 *   retrieval ran alongside keyword. This is the intended steady state.
 * - `"keyword-only"`: the query embedding call failed (OpenRouter outage,
 *   missing/invalid API key, network egress blocked) and the response was
 *   assembled from keyword retrieval alone. The response is still useful
 *   but lacks scene-level thematic matches. Consumers can render a
 *   "advanced search temporarily unavailable" affordance when this is set.
 */
export type SearchMode = "hybrid" | "keyword-only"

export type SearchResponse = {
  results: SearchResult[]
  /** True when more results exist beyond the current page. */
  hasMore: boolean
  query: string
  /** Which retrieval paths actually contributed to this response. */
  searchMode: SearchMode
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

  // Normalize the optional `mode` input. Computed once so the
  // warn-and-fallback log fires per call, and so the video-retrieval
  // branch below reads from a closed set rather than reparsing the
  // raw string. See feat-109.
  const mode: RetrievalMode = normalizeMode(strapi, params.mode)

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
  // Failures are logged at error level (a silent warn let feat-097 hide
  // in production for days before anyone noticed) and tracked via
  // process-local counters that the `/api/search/health` endpoint exposes.
  let queryEmbedding: string | null = null
  recordAttempt()
  try {
    const queryVector = await embedQuery(query)
    queryEmbedding = toPgvectorText(queryVector)
  } catch (error) {
    recordFailure(error)
    const errorClass =
      error instanceof Error ? error.constructor.name : "UnknownError"
    const message = error instanceof Error ? error.message : String(error)
    strapi.log.error(
      `[search] event=query_embedding_failure error_class=${errorClass} message=${message}`,
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
    // Semantic retrieval is shared between modes — `searchBySemantic`
    // is unchanged whether the caller opts into the lexical stack or
    // not. Pgvector does not benefit from the new GIN indexes.
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

    if (mode === "keyword-first") {
      // Keyword-first stack: weighted phrase-aware tsquery + trigram
      // (typo / prefix tolerance) + exact-title (every token in title).
      // Together with semantic above, fusion sees four ranked lists.
      // The legacy `searchByKeyword` is NOT called in this branch — the
      // weighted retriever supersedes it for callers that opt in.
      retrievals.push({
        label: "keyword-weighted-video",
        promise: searchByKeywordWeighted(knex, {
          query,
          locale,
          limit: overfetchLimit,
        }).then((rows) => rows.map(annotateVideo)),
      })
      retrievals.push({
        label: "trigram-video",
        promise: searchByTrigram(knex, {
          query,
          locale,
          limit: overfetchLimit,
        }).then((rows) => rows.map(annotateVideo)),
      })
      retrievals.push({
        label: "exact-title-video",
        promise: searchByExactTitle(knex, {
          query,
          locale,
          limit: overfetchLimit,
        }).then((rows) => rows.map(annotateVideo)),
      })
    } else {
      // Hybrid mode (default) — unchanged from `main`. Reads the legacy
      // `videos_fulltext_search_idx` provisioned in ensure-pgvector.ts.
      retrievals.push({
        label: "keyword-video",
        promise: searchByKeyword(knex, {
          query,
          locale,
          limit: overfetchLimit,
        }).then((rows) => rows.map(annotateVideo)),
      })
    }
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
    // queryEmbedding is only non-null when OpenRouter's embedding call
    // succeeded and both semantic retrievals were dispatched. If it's
    // null, the response is assembled from keyword retrieval alone.
    searchMode: queryEmbedding != null ? "hybrid" : "keyword-only",
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
