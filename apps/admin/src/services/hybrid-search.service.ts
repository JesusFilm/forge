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

import type { PrismaClient, VideoLabel } from "@prisma/client"
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
  tokenizeForExactTitle,
} from "./hybrid-search-keyword-first-retrievers"

export const RRF_K = 60
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50
export const OVERFETCH_FACTOR = 3

/**
 * Top-N keyword-side window used by the dilution cap. Plan-default 3.
 * Higher widens the "this result genuinely shares an entity with the
 * keyword winner" allowlist; lower bites harder.
 */
export const DILUTION_CAP_TOP_N = 3

/** Down-weight applied by the dilution cap to semantic-only results
 *  with no keyword-side core_id overlap. Plan-default 0.5. */
export const DILUTION_CAP_DOWNWEIGHT = 0.5

/**
 * Read the dilution cap toggle. Default `true` (cap is active in
 * keyword-first mode unless explicitly disabled by setting the env
 * var to `"false"`). Hybrid mode never reaches the cap step regardless.
 *
 * Tolerant parser (e.g. accepting `"0"`, `"off"`) is a documented
 * follow-up; today only the literal string `"false"` disables the cap.
 */
export function isDilutionCapEnabled(): boolean {
  return process.env.SEARCH_DILUTION_CAP_ENABLED !== "false"
}

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
  /**
   * When true, the orchestrator attaches per-result internal scoring
   * detail under `result.debug` (per-retriever ranks, fused score,
   * dilution-cap state). The boundary is responsible for origin-gating
   * via `isDebugAllowedForOrigin`; the service trusts the boolean.
   */
  debug?: boolean
}

/**
 * Per-result debug payload. Surfaces internal scoring detail for
 * operator inspection; origin-gated at the REST + GraphQL boundary.
 *
 * **Retriever labels are UNSTABLE** — they're internal implementation
 * names and may be renamed without a breaking-change marker. Operators
 * inspecting a payload for triage are the intended audience; do not
 * branch on these strings in production code.
 */
export type SearchResultDebug = {
  retrieverRanks: Array<{ label: string; rank: number }>
  fusedScore: number
  dilutionCapApplied: boolean
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
  /**
   * Card-pill hydration fields. Populated for video results via a single
   * post-fusion batch query; null for experience results.
   *
   * - `label`: admin's VideoLabel enum (`EPISODE`, `SERIES`, `SHORT_FILM`,
   *   …). Typed as Prisma's generated `VideoLabel` enum so adding a new
   *   value to schema.prisma surfaces compile-time errors here, in the
   *   Pothos resolver, and in the gql.tada introspection consumer on web
   *   — keeping the three layers in lockstep without a hand-mirrored
   *   string union. null when type=experience.
   * - `durationSeconds`: primary playable VideoDub duration in seconds.
   *   null when type=experience or when the video has no playable dub
   *   (e.g., a SERIES record with episodes-as-children).
   * - `childCount`: count of `video_relation` rows where parent_id = this
   *   row's id, filtered to match the consumer-facing ABAC (published
   *   children only). null when type=experience; 0 when type=video and
   *   the video has no qualifying children.
   */
  label: VideoLabel | null
  durationSeconds: number | null
  childCount: number | null
  /**
   * Internal scoring detail. Present only when the caller passed
   * `debug: true` AND the request origin is on the debug allowlist
   * (origin gating is the boundary's responsibility). Stripped
   * silently otherwise.
   */
  debug?: SearchResultDebug
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
      label: null,
      durationSeconds: null,
      childCount: null,
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
    // Card-pill fields populated by the post-fusion hydration pass.
    // Defaults here keep the mapper pure (no DB IO) and let the service
    // overlay real values after one batch query.
    label: null,
    durationSeconds: null,
    childCount: null,
  }
}

/**
 * Cap on dubs returned per video by the hydration sub-include. The
 * selector picks one row to compute `durationSeconds`; a small N
 * (primary-language dub + a handful of regional fallbacks) is sufficient
 * and bounds the worst case at 50 videos × 5 dubs = 250 rows per request
 * rather than thousands for heavily-dubbed titles (some collections in
 * the catalogue carry 200+ published dubs).
 */
const HYDRATION_DUBS_PER_VIDEO = 5

/**
 * Card-pill hydration. Given the final page of video-type results,
 * batch-load `label`, primary playable dub duration, and child count
 * in ONE Prisma query and return a new array with those fields filled
 * in. Experience results pass through untouched (their card surface
 * doesn't carry a pill in the current design).
 *
 * Why a post-mapping pass instead of fetching the data inline in each
 * retriever: the retrievers project tightly via `$queryRaw` for index
 * use; adding 3 extra fields per retriever would either duplicate the
 * LATERALs across 4+ SQL paths or force a UNION shape change. A single
 * `findMany({ where: { id: { in: [...] } } })` after pagination is
 * O(page-size) — at most ~50 rows for MAX_LIMIT — and keeps the SQL
 * read paths unchanged.
 *
 * Returns a NEW array (not mutating the input). Soft-deleted-mid-search
 * rows pass through with null pill fields — they keep title/slug from
 * the retriever's snapshot but won't surface a count or duration. The
 * narrow race window (~10ms) and the cost of coupling every test
 * fixture to per-id hydration stubs argues against dropping; if the
 * UX of "card-then-404" becomes meaningful, switch to a drop here.
 */
async function hydrateCardPillFields(
  prisma: PrismaClient,
  results: SearchResult[],
  logger?: { error: (msg: string) => void },
): Promise<SearchResult[]> {
  const videoIds = results.filter((r) => r.type === "video").map((r) => r.id)
  if (videoIds.length === 0) return results

  // Hydration data (label / durationSeconds / childCount) is cosmetic —
  // a card renders without it. A Prisma error here must NOT take the
  // search endpoint down. Catch, log, and pass through the pre-hydration
  // array; consumers see a search response with null pill fields rather
  // than HTTP 503 for the whole request.
  let rows
  try {
    rows = await prisma.video.findMany({
      where: { id: { in: videoIds }, deletedAt: null },
      select: {
        id: true,
        label: true,
        primaryLanguageId: true,
        dubs: {
          // `duration: { gt: 0 }` excludes sync-glitch rows (Core
          // occasionally returns a published dub with duration=0; the
          // pill picker then renders nothing for those rows, leaving an
          // unexplained gap on the card).
          where: {
            published: true,
            hls: { not: null },
            deletedAt: null,
            duration: { gt: 0 },
          },
          // `take` bounds the per-video dubs scan. Order by duration
          // descending so the longest published in-locale dub anchors
          // the top of the page; the post-query `find` below prefers the
          // primary-language dub among these top-N rows, falling back to
          // `dubs[0]` (longest) when the primary dub isn't in the top-N
          // by duration. On heavily-dubbed videos (200+ dubs) the primary
          // may rank below position N — accept the fallback rather than
          // widen `take` (cost is bounded at 50 × N rows per request).
          orderBy: [{ duration: "desc" }],
          take: HYDRATION_DUBS_PER_VIDEO,
          select: { languageId: true, duration: true },
        },
        // `_count.children` mirrors the consumer-facing ABAC at
        // videoChildrenFilter (apps/admin/src/graphql/types/video.ts):
        // only count children that have a PUBLISHED locale and aren't
        // soft-deleted. Without this filter the search-card "{n} episodes"
        // pill drifts from what the watch page actually renders. Self-
        // referential rows (parent_id = child_id) — a data-quality issue
        // seen for `1-jesus-our-loving-pursuer` — can still inflate the
        // count; web's normalizeAdminVideo filters those client-side, but
        // the count is computed before that pass. Acceptable today; if
        // self-ref inflation becomes a UX issue, switch to a raw SQL
        // count that adds `WHERE child_id <> parent_id`.
        _count: {
          select: {
            children: {
              where: {
                child: {
                  deletedAt: null,
                  locales: { some: { status: "PUBLISHED" } },
                },
              },
            },
          },
        },
      },
    })
  } catch (err) {
    const log = logger ?? console
    log.error(
      `[search] event=hydration_failed message=${err instanceof Error ? err.message : String(err)}`,
    )
    return results
  }

  const hydration = new Map<
    string,
    {
      label: VideoLabel | null
      durationSeconds: number | null
      childCount: number
    }
  >()
  for (const row of rows) {
    // Pick the primary-language dub when available; otherwise the
    // longest-duration playable dub (the orderBy in the sub-include
    // sorted them). `duration` is already in seconds (Int?); the
    // millisecond column on VideoDub uses BigInt and isn't needed for
    // pill display where second precision is the right fidelity.
    const primaryDub = row.primaryLanguageId
      ? row.dubs.find((d) => d.languageId === row.primaryLanguageId)
      : undefined
    const dub = primaryDub ?? row.dubs[0] ?? null
    hydration.set(row.id, {
      label: row.label,
      durationSeconds: dub?.duration ?? null,
      childCount: row._count.children,
    })
  }

  return results.map((r) => {
    if (r.type !== "video") return r
    const h = hydration.get(r.id)
    if (h == null) return r
    return {
      ...r,
      label: h.label,
      durationSeconds: h.durationSeconds,
      childCount: h.childCount,
    }
  })
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

    // (label, list) pairs for downstream origin tracking. Used by both
    // the dilution cap and the debug payload.
    const labeledLists = retrievals.map((r, i) => ({
      label: r.label,
      list: lists[i] ?? [],
    }))

    // Per-key origin + rank map. Built unconditionally because the cap
    // logic also reads it — even when the user didn't pass `debug:true`.
    // Stripping happens at the response-mapping step below.
    const debugByKey = new Map<string, SearchResultDebug>()
    for (const { label, list } of labeledLists) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i]!
        const key = `${item.resultType}:${item.resultId}`
        const existing = debugByKey.get(key)
        if (existing == null) {
          debugByKey.set(key, {
            retrieverRanks: [{ label, rank: i + 1 }],
            fusedScore: 0,
            dilutionCapApplied: false,
          })
        } else {
          existing.retrieverRanks.push({ label, rank: i + 1 })
        }
      }
    }

    // Step 3: Fuse ranked lists via RRF. Drop empty lists first — RRF
    // normalizes by dividing by the number of input lists, so empty
    // ones dilute scores from lists that did contribute.
    const nonEmptyLists = lists.filter((list) => list.length > 0)
    const fused = fuseRankedLists(nonEmptyLists, RRF_K)

    // Snapshot pre-cap fused scores so the debug payload can surface
    // both numbers (the cap mutates `result.score` in place).
    for (const result of fused) {
      const key = `${result.resultType}:${result.resultId}`
      const trace = debugByKey.get(key)
      if (trace != null) trace.fusedScore = result.score
    }

    // Step 3b: Semantic-dilution cap. Active only in keyword-first mode
    // and only when an exact-title hit exists. Halves the score of any
    // fused result whose ONLY contributing list was semantic AND whose
    // video core_id is not represented in the top-N keyword-side
    // core_ids. Hybrid mode never reaches this step.
    if (pipelineMode === "keyword-first" && isDilutionCapEnabled()) {
      applyDilutionCap(fused, labeledLists, query, debugByKey)
    }

    // Step 4: Dedup one extra result beyond the page window so we know
    // whether more results exist (drives hasMore without a full count
    // pass).
    const deduped = deduplicateResults(fused, offset + limit + 1)

    // Step 5: Paginate and map to API contract.
    const page = deduped.slice(offset, offset + limit)
    const hasMore = deduped.length > offset + limit
    const mapped = page.map((result) => {
      const base = mapToSearchResult(result)
      if (params.debug !== true) return base
      const key = `${result.resultType}:${result.resultId}`
      const trace = debugByKey.get(key)
      if (trace == null) return base
      return { ...base, debug: trace }
    })

    // Hydrate card-pill fields (label, durationSeconds, childCount) for
    // video results in one batched query. Experience rows are left as
    // (null, null, null) by the mapper; this pass only touches videos
    // and returns a fresh array — soft-deleted-mid-search rows are
    // filtered out rather than surfaced with stale title + null pill.
    const results = await hydrateCardPillFields(
      this.prisma,
      mapped,
      this.logger,
    )

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

/**
 * Apply the keyword-first semantic-dilution cap.
 *
 * Triggers iff the exact-title list returned at least one result whose
 * title (lowercased + tokenized) contains every query token — i.e. the
 * user typed something with a clear lexical winner.
 *
 * When triggered, any fused result whose ONLY contributing list was
 * `"semantic-video"` AND whose `videoCoreId` is null OR not in the
 * top-N (default 3) of the three keyword-side lists' core_ids gets
 * `score *= DILUTION_CAP_DOWNWEIGHT`. The list is then re-sorted.
 *
 * Mutates `fused` in place. Records cap application on `debugByKey`
 * so the optional debug payload can surface it.
 *
 * Hard filtering is intentionally NOT used: thematic queries
 * ("hope when life is hard") have no exact-title trigger, so the cap
 * silently does nothing on them.
 *
 * Exported for unit-level testing.
 */
export function applyDilutionCap(
  fused: FusedResult[],
  labeledLists: Array<{ label: string; list: RankedItem[] }>,
  query: string,
  debugByKey: Map<string, SearchResultDebug>,
): void {
  const exactTitleList =
    labeledLists.find((ll) => ll.label === "exact-title-video")?.list ?? []

  const tokens = tokenizeForExactTitle(query)
  if (tokens.length === 0) return

  const triggered = exactTitleList.some((item) => {
    const title = (item.videoTitle ?? "").toLowerCase()
    return tokens.every((t) => title.includes(t))
  })
  if (!triggered) return

  // Top-N keyword-side core_ids — the "this entity is genuinely a
  // keyword winner" allowlist. Aggregated across the three lexical
  // retrievers; a result represented in any of them is exempt.
  const topNCoreIds = new Set<string>()
  for (const label of [
    "keyword-weighted-video",
    "trigram-video",
    "exact-title-video",
  ]) {
    const list = labeledLists.find((ll) => ll.label === label)?.list ?? []
    for (let i = 0; i < Math.min(DILUTION_CAP_TOP_N, list.length); i++) {
      const cid = list[i]!.videoCoreId ?? null
      if (cid != null && cid.length > 0) topNCoreIds.add(cid)
    }
  }

  for (const result of fused) {
    if (result.resultType !== "video") continue

    const key = `${result.resultType}:${result.resultId}`
    const trace = debugByKey.get(key)
    const origins = new Set((trace?.retrieverRanks ?? []).map((r) => r.label))
    const onlySemantic = origins.size === 1 && origins.has("semantic-video")
    if (!onlySemantic) continue

    const cid = result.videoCoreId ?? null
    const sharesKeywordCoreId =
      cid != null && cid.length > 0 && topNCoreIds.has(cid)
    if (sharesKeywordCoreId) continue

    result.score *= DILUTION_CAP_DOWNWEIGHT
    if (trace != null) trace.dilutionCapApplied = true
  }

  fused.sort((a, b) => b.score - a.score)
}
