/**
 * Hybrid search orchestrator — port of
 * apps/cms/src/api/search/services/search.ts against admin's schema.
 *
 * Step-by-step:
 * 1. Embed the user's query via admin's embedding provider. On failure,
 *    degrade to keyword-only search instead of returning 503 — keyword
 *    search has no external dependencies and is valuable on its own.
 * 2. Run retrieval in parallel based on `contentTypes` — up to 4 lists
 *    (video semantic, video keyword, experience semantic, experience
 *    keyword) via Promise.allSettled, so one retrieval failing does not
 *    discard the others.
 * 3. Merge via Reciprocal Rank Fusion. Empty result lists are filtered
 *    out before fusion (RRF normalizes by N-list count, and feeding
 *    empty ones dilutes scores from lists that did contribute).
 * 4. Deduplicate (3-layer for videos; experiences pass through).
 * 5. Paginate with hasMore signal (dedup one extra to detect overflow).
 */

import type { PrismaClient } from "@prisma/client"
import { generateExperienceEmbedding } from "./embeddings.service"
import {
  fuseRankedLists,
  deduplicateResults,
  type FusedResult,
  type RankedItem,
} from "./hybrid-search-fusion"
import { recordAttempt, recordFailure } from "./hybrid-search-health"
import {
  searchVideoSemantic,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
} from "./hybrid-search-retrievers"
import {
  searchByKeywordWeighted,
  searchByTrigram,
  searchByExactTitle,
} from "./hybrid-search-keyword-first-retrievers"

export const RRF_K = 60
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50
export const OVERFETCH_FACTOR = 3

export type ContentType = "video" | "experience"

export const ALL_CONTENT_TYPES: readonly ContentType[] = ["video", "experience"]

/**
 * Boundary type guard shared by REST and GraphQL. Adding a new content
 * type means updating the union + `ALL_CONTENT_TYPES` in one place.
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
   * Restrict results to the given content types. Omit (or pass
   * undefined) to search both videos and experiences. Passing an empty
   * array also defaults to both, since "no results" is rarely the
   * caller's intent.
   */
  contentTypes?: ContentType[]
  /**
   * Opt-in retrieval pipeline selector. Defaults to `"hybrid"` (the R4
   * baseline). `"keyword-first"` activates the lexical retriever stack
   * (Unit 3 onward). Unknown values warn-and-fall-back to `"hybrid"`;
   * never throws. Stays a nullable string at the type level (and at
   * the REST/GraphQL boundaries) so future modes can ship without
   * schema changes — `normalizeMode()` is the canonical decoder.
   *
   * Orthogonal to the `searchMode` *response* field, which is the
   * embedding-degradation signal (`"hybrid"|"keyword-only"`).
   */
  mode?: string | null
}

/**
 * Closed set of canonical retrieval pipelines after `normalizeMode`.
 *
 * Internal type — do NOT use as a GraphQL/REST input type. The boundary
 * stays a nullable string so `normalizeMode` can warn-and-fall-back on
 * unknown values without breaking clients on rollouts of new modes.
 */
export type SearchPipelineMode = "hybrid" | "keyword-first"

/**
 * Sanitizer for user-supplied values that get interpolated into
 * structured log lines. Strips CR/LF/TAB so an attacker cannot inject
 * synthetic `event=...` tokens via the request, and clamps length so
 * a 1MB pasted string cannot bloat log shipping.
 *
 * Per docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md.
 */
export function sanitizeForLog(raw: unknown): string {
  return String(raw)
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64)
}

/**
 * Decodes the public `mode` argument to a canonical pipeline mode.
 *
 * `unset | null | "" | "hybrid"` → `"hybrid"`.
 * `"keyword-first"` → `"keyword-first"`.
 * anything else → `"hybrid"`, with a single structured warn log
 * carrying the sanitized raw value.
 *
 * Never throws. The warn line is fire-once-per-call (callers invoke
 * this exactly once at request entry).
 */
export function normalizeMode(
  raw: string | null | undefined,
  logger: { warn: (message: string) => void },
): SearchPipelineMode {
  if (raw == null || raw === "" || raw === "hybrid") return "hybrid"
  if (raw === "keyword-first") return "keyword-first"
  logger.warn(
    `[search] event=search_unknown_mode mode=${sanitizeForLog(raw)} falling_back=hybrid`,
  )
  return "hybrid"
}

export type SearchResult = {
  type: ContentType
  /** cuid (admin-native). Was integer in cms. */
  id: string
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  /** null when the match is keyword-only or for non-video results. */
  startSeconds: number | null
  /** null when the match is keyword-only or for non-video results. */
  playbackId: string | null
  score: number
}

/**
 * Describes which retrieval paths actually contributed to a response.
 *
 * - `"hybrid"`: the query embedding was generated successfully and
 *   semantic retrieval ran alongside keyword. Steady state.
 * - `"keyword-only"`: the query embedding call failed (provider outage,
 *   missing/invalid API key, network egress blocked) and the response
 *   was assembled from keyword retrieval alone. Response is still
 *   useful but lacks scene-level / semantic-experience matches.
 */
export type SearchMode = "hybrid" | "keyword-only"

export type SearchResponse = {
  results: SearchResult[]
  /** True when more results exist beyond the current page. */
  hasMore: boolean
  query: string
  searchMode: SearchMode
}

/**
 * Converts a number[] embedding vector to pgvector text format
 * "[0.1,0.2,...]". Kept local rather than importing toPgVector from
 * db/pgvector so this file has no DB helper dependency (the retrievers
 * own DB-layer concerns).
 */
function toPgvectorText(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Injectable embedder signature so tests can stub the provider call
 * without mocking the module import.
 */
export type QueryEmbedder = (text: string) => Promise<number[]>

const defaultEmbedder: QueryEmbedder = async (text) => {
  const result = await generateExperienceEmbedding(text)
  return result.embedding
}

/**
 * Map a fused result to the API response contract.
 *
 * Video rows may carry scene-level data (description as snippet,
 * startSeconds + playbackId for semantic matches; null for
 * keyword-only). Experience rows carry experience-level data
 * (metaDescription as snippet) with null startSeconds/playbackId.
 */
function mapToSearchResult(result: FusedResult): SearchResult {
  const score = Math.round(result.score * 1000) / 1000

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
      score,
    }
  }

  const startSeconds = result.startSeconds
  const playbackId = result.playbackId
  return {
    type: "video",
    id: result.resultId,
    slug: (result.videoSlug as string) ?? "",
    title: (result.videoTitle as string) ?? "",
    imageUrl: (result.imageUrl as string | null) ?? null,
    // Semantic-video rows carry scene-level `sceneDescription`; keyword
    // rows carry video-level `description`. Fusion merges earlier-list
    // properties first, so a video that hits both lists keeps the
    // semantic scene description (the richer signal).
    snippet:
      (result.sceneDescription as string | undefined) ??
      (result.description as string | undefined) ??
      "",
    startSeconds: typeof startSeconds === "number" ? startSeconds : null,
    playbackId: typeof playbackId === "string" ? playbackId : null,
    score,
  }
}

export type HybridSearchServiceDeps = {
  prisma: PrismaClient
  embedder?: QueryEmbedder
  /** Injectable logger; defaults to console. Mirror the cms `log.error`
   *  / `log.warn` shape so operators see the same `event=...` structured
   *  lines across the cms→admin migration window. `warn` is consulted
   *  for unknown-mode fallback; `error` for embedding/retrieval failures. */
  logger?: {
    error: (message: string) => void
    warn: (message: string) => void
  }
}

export class HybridSearchService {
  private readonly prisma: PrismaClient
  private readonly embedder: QueryEmbedder
  private readonly logger: {
    error: (message: string) => void
    warn: (message: string) => void
  }

  constructor(deps: HybridSearchServiceDeps) {
    this.prisma = deps.prisma
    this.embedder = deps.embedder ?? defaultEmbedder
    this.logger = deps.logger ?? {
      error: (message: string) => console.error(message),
      warn: (message: string) => console.warn(message),
    }
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const { query, locale } = params

    // Decode the opt-in pipeline mode. Unknown values warn-and-fall-back
    // to "hybrid" without throwing — same contract REST + GraphQL
    // surface to clients. Computed once per call so the warn log fires
    // at most once.
    const pipelineMode = normalizeMode(params.mode, this.logger)
    const limit = Math.min(
      Math.max(1, params.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    )
    const offset = Math.max(0, params.offset ?? 0)
    const overfetchLimit = limit * OVERFETCH_FACTOR

    // Resolve which content types to search. Empty array falls back to
    // all types — no caller realistically wants "search nothing".
    const requested =
      params.contentTypes != null && params.contentTypes.length > 0
        ? params.contentTypes
        : ALL_CONTENT_TYPES
    const wantsVideos = requested.includes("video")
    const wantsExperiences = requested.includes("experience")

    // Step 1: Embed the user's query. Degrade gracefully if the
    // provider is unavailable — keyword search alone still returns
    // useful results. Failures are logged at error level (a silent
    // warn let feat-097 hide in production for days) and tracked via
    // process-local counters the health probe exposes.
    let queryEmbeddingText: string | null = null
    recordAttempt()
    try {
      const vector = await this.embedder(query)
      queryEmbeddingText = toPgvectorText(vector)
    } catch (error) {
      recordFailure(error)
      const errorClass =
        error instanceof Error ? error.constructor.name : "UnknownError"
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `[search] event=query_embedding_failure error_class=${errorClass} message=${message}`,
      )
    }

    // Step 2: Run retrieval in parallel. allSettled keeps partial
    // results when one retrieval fails (e.g. pgvector timeout but
    // keyword succeeds). Each retrieval is paired with a label so
    // outcomes can map back to their source for logging.
    type Retrieval = {
      label: string
      promise: Promise<RankedItem[]>
    }
    const retrievals: Retrieval[] = []

    if (wantsVideos) {
      // Semantic-video is shared between hybrid and keyword-first —
      // both pipelines benefit from scene-level vector matches.
      retrievals.push({
        label: "semantic-video",
        promise:
          queryEmbeddingText != null
            ? (searchVideoSemantic(this.prisma, {
                queryEmbedding: queryEmbeddingText,
                locale,
                limit: overfetchLimit,
              }) as Promise<RankedItem[]>)
            : Promise.resolve([]),
      })

      if (pipelineMode === "keyword-first") {
        // Three-list lexical stack: phrase-aware weighted tsvector,
        // typo-tolerant trigram on title, and exact-token-in-title
        // (Algolia-like). The legacy R4 `searchVideoKeyword` is NOT
        // dispatched on this branch — its concatenated tsvector is
        // strictly weaker than the weighted one for this workload.
        retrievals.push({
          label: "keyword-weighted-video",
          promise: searchByKeywordWeighted(this.prisma, {
            query,
            locale,
            limit: overfetchLimit,
          }) as Promise<RankedItem[]>,
        })
        retrievals.push({
          label: "trigram-video",
          promise: searchByTrigram(this.prisma, {
            query,
            locale,
            limit: overfetchLimit,
          }) as Promise<RankedItem[]>,
        })
        retrievals.push({
          label: "exact-title-video",
          promise: searchByExactTitle(this.prisma, {
            query,
            locale,
            limit: overfetchLimit,
          }) as Promise<RankedItem[]>,
        })
      } else {
        // Hybrid path — UNCHANGED from R4. Byte-identity locked in by
        // hybrid-search.regression.test.ts.
        retrievals.push({
          label: "keyword-video",
          promise: searchVideoKeyword(this.prisma, {
            query,
            locale,
            limit: overfetchLimit,
          }) as Promise<RankedItem[]>,
        })
      }
    }

    if (wantsExperiences) {
      retrievals.push({
        label: "semantic-experience",
        promise:
          queryEmbeddingText != null
            ? (searchExperienceSemantic(this.prisma, {
                queryEmbedding: queryEmbeddingText,
                locale,
                limit: overfetchLimit,
              }) as Promise<RankedItem[]>)
            : Promise.resolve([]),
      })
      retrievals.push({
        label: "keyword-experience",
        promise: searchExperienceKeyword(this.prisma, {
          query,
          locale,
          limit: overfetchLimit,
        }) as Promise<RankedItem[]>,
      })
    }

    const outcomes = await Promise.allSettled(retrievals.map((r) => r.promise))
    const lists = outcomes.map((outcome, i) =>
      this.unwrapOutcome(outcome, retrievals[i]!.label),
    )

    // Step 3: Fuse ranked lists via RRF. Drop empty lists first — RRF
    // normalizes by dividing by the number of input lists, so empty
    // ones dilute scores from lists that did contribute.
    const nonEmptyLists = lists.filter((list) => list.length > 0)
    const fused = fuseRankedLists(nonEmptyLists, RRF_K)

    // Step 4: Dedup one extra result beyond the page window so we know
    // whether more results exist (drives hasMore without a full count
    // pass).
    const deduped = deduplicateResults(fused, offset + limit + 1)

    // Step 5: Paginate and map to API contract.
    const page = deduped.slice(offset, offset + limit)
    const hasMore = deduped.length > offset + limit
    const results = page.map(mapToSearchResult)

    return {
      results,
      hasMore,
      query,
      // queryEmbeddingText is non-null iff the embedding call succeeded
      // and both semantic retrievals were dispatched. If null, the
      // response is assembled from keyword retrieval alone.
      searchMode: queryEmbeddingText != null ? "hybrid" : "keyword-only",
    }
  }

  private unwrapOutcome<T>(
    outcome: PromiseSettledResult<T[]>,
    label: string,
  ): T[] {
    if (outcome.status === "fulfilled") return outcome.value
    this.logger.error(
      `[search] ${label} retrieval failed: ${
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason)
      }`,
    )
    return []
  }
}
