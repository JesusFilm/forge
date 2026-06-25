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

import { Prisma, type PrismaClient, type VideoLabel } from "@prisma/client"
import {
  EXPERIENCE_EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
  generateExperienceEmbedding,
} from "./embeddings.service"
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
import {
  activeTimingIntervalsMs,
  boundedMs,
  elapsedMs,
  nowMs,
  recordSearchDbTiming,
  SearchTimingRecorder,
  type SearchTimingInterval,
  type SearchRetrieverTiming,
  type SearchTimingSummary,
} from "./hybrid-search-timing"

export {
  formatSearchTimingLogLine,
  formatSearchTimingLogFields,
  searchTimingLogValue,
} from "./hybrid-search-timing"
export type {
  SearchDbTiming,
  SearchRetrieverTiming,
  SearchTimingRouteSource,
  SearchTimingSummary,
} from "./hybrid-search-timing"

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
   * Internal eval-only escape hatch for diagnostic retrieval modes.
   * Public REST and GraphQL must not set this; keeping the flag private
   * lets those boundaries continue forwarding raw `mode` strings while
   * unknown values safely fall back to hybrid.
   */
  allowInternalEvalModes?: boolean
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
export type SearchPipelineMode = "hybrid" | "keyword-first" | "semantic-only"

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
  options: { allowInternalEvalModes?: boolean } = {},
): SearchPipelineMode {
  if (raw == null || raw === "" || raw === "hybrid") return "hybrid"
  if (raw === "keyword-first") return "keyword-first"
  if (raw === "semantic-only" && options.allowInternalEvalModes === true) {
    return "semantic-only"
  }
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
  /** null when the match has no timed evidence or for non-video results. */
  startSeconds: number | null
  /** null when no playable Mux-backed dub was found or for non-video results. */
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
 *   semantic retrieval ran. Steady state.
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

export type SearchExecutionSummary = {
  searchMode: SearchMode
  resultCount: number
  outcome: "success" | "degraded"
  traceClass: string
  failedRetrievers: string[]
  contributingRetrievers: string[]
}

export type SearchWithTraceResult = {
  response: SearchResponse
  trace: SearchExecutionSummary
  timings: SearchTimingSummary
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

const QUERY_EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_EMBEDDING_CACHE_MAX_ENTRIES = 512
const QUERY_EMBEDDING_PROVIDER = "openrouter"

type CachedQueryEmbedding = {
  embedding: number[]
  expiresAt: number
}

const queryEmbeddingCache = new Map<string, CachedQueryEmbedding>()
const queryEmbeddingInflight = new Map<string, Promise<number[]>>()

function normalizeEmbeddingCacheText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function queryEmbeddingCacheKey(text: string): string {
  return JSON.stringify({
    provider: QUERY_EMBEDDING_PROVIDER,
    model: OPENROUTER_EMBEDDING_MODEL,
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    text: normalizeEmbeddingCacheText(text),
  })
}

function cloneEmbedding(embedding: readonly number[]): number[] {
  return [...embedding]
}

function readCachedQueryEmbedding(key: string): number[] | null {
  const cached = queryEmbeddingCache.get(key)
  if (cached == null) return null

  if (cached.expiresAt <= Date.now()) {
    queryEmbeddingCache.delete(key)
    return null
  }

  queryEmbeddingCache.delete(key)
  queryEmbeddingCache.set(key, cached)
  return cloneEmbedding(cached.embedding)
}

function rememberQueryEmbedding(key: string, embedding: readonly number[]) {
  if (queryEmbeddingCache.has(key)) queryEmbeddingCache.delete(key)

  while (queryEmbeddingCache.size >= QUERY_EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = queryEmbeddingCache.keys().next().value
    if (oldestKey == null) break
    queryEmbeddingCache.delete(oldestKey)
  }

  queryEmbeddingCache.set(key, {
    embedding: cloneEmbedding(embedding),
    expiresAt: Date.now() + QUERY_EMBEDDING_CACHE_TTL_MS,
  })
}

export function __resetQueryEmbeddingCacheForTest() {
  queryEmbeddingCache.clear()
  queryEmbeddingInflight.clear()
}

const defaultEmbedder: QueryEmbedder = async (text) => {
  const key = queryEmbeddingCacheKey(text)
  const cached = readCachedQueryEmbedding(key)
  if (cached != null) return cached

  const inflight = queryEmbeddingInflight.get(key)
  if (inflight != null) return cloneEmbedding(await inflight)

  const request = (async () => {
    recordAttempt()
    try {
      const result = await generateExperienceEmbedding(text)
      rememberQueryEmbedding(key, result.embedding)
      return cloneEmbedding(result.embedding)
    } catch (error) {
      recordFailure(error)
      throw error
    } finally {
      queryEmbeddingInflight.delete(key)
    }
  })()
  queryEmbeddingInflight.set(key, request)

  return cloneEmbedding(await request)
}

/**
 * Map a fused result to the API response contract.
 *
 * Video rows may carry evidence-level data from retrievers (scene/transcript
 * text, startSeconds + playbackId for semantic matches; null for keyword-only).
 * The post-fusion hydration pass below replaces the public snippet with
 * video-level metadata when it exists. Experience rows carry experience-level
 * data (metaDescription as snippet) with null startSeconds/playbackId.
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
    // Initial fallback only. `hydrateCardDisplayFields` replaces this
    // evidence text with VideoLocale description/snippet for the public
    // card surface when localized metadata exists.
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
 * Cap on dubs returned per video by the hydration dub query. The
 * selector picks one row to compute `durationSeconds`; a small N
 * (primary-language dub + a handful of regional fallbacks) is sufficient
 * and bounds the worst case at 50 videos × 5 dubs = 250 rows per request
 * rather than thousands for heavily-dubbed titles (some collections in
 * the catalogue carry 200+ published dubs).
 */
const HYDRATION_DUBS_PER_VIDEO = 5
const HYDRATION_IMAGES_PER_VIDEO = 5

type HydrationBaseRow = {
  id: string
  label: VideoLabel | null
  primaryLanguageId: string | null
}

type HydrationLocaleRow = {
  videoId: string
  description: string | null
  snippet: string | null
}

type HydrationImageRow = {
  videoId: string
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  videoStill: string | null
  thumbnail: string | null
  url: string | null
}

type HydrationDubRow = {
  videoId: string
  languageId: string | null
  duration: number | null
  playbackId: string | null
}

type HydrationChildCountRow = {
  videoId: string
  childCount: number | bigint | null
}

type HydrationDataRow = HydrationBaseRow & {
  locales: HydrationLocaleRow[]
  images: HydrationImageRow[]
  dubs: HydrationDubRow[]
  childCount: number
}

function groupByVideoId<T extends { videoId: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const group = grouped.get(row.videoId)
    if (group != null) {
      group.push(row)
    } else {
      grouped.set(row.videoId, [row])
    }
  }
  return grouped
}

function toChildCount(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  return 0
}

async function loadHydrationDataRows(
  prisma: PrismaClient,
  videoIds: string[],
  locale: string,
  timing?: SearchTimingRecorder,
): Promise<HydrationDataRow[]> {
  const [baseRows, localeRows, imageRows, dubRows, childCountRows] =
    await Promise.all([
      recordSearchDbTiming(
        timing,
        "hydration.video.findMany",
        () =>
          prisma.video.findMany({
            where: { id: { in: videoIds }, deletedAt: null },
            select: {
              id: true,
              label: true,
              primaryLanguageId: true,
            },
          }) as Promise<HydrationBaseRow[]>,
      ),
      recordSearchDbTiming(
        timing,
        "hydration.videoLocale.findMany",
        () =>
          prisma.videoLocale.findMany({
            where: {
              videoId: { in: videoIds },
              locale,
              status: "PUBLISHED",
              deletedAt: null,
            },
            select: {
              videoId: true,
              description: true,
              snippet: true,
            },
          }) as Promise<HydrationLocaleRow[]>,
      ),
      recordSearchDbTiming(
        timing,
        "hydration.videoImage.query",
        () =>
          prisma.$queryRaw<HydrationImageRow[]>`
        SELECT
          ranked."videoId",
          ranked."mobileCinematicHigh",
          ranked."mobileCinematicLow",
          ranked."videoStill",
          ranked.thumbnail,
          ranked.url
        FROM (
          SELECT
            vi.video_id AS "videoId",
            vi.mobile_cinematic_high AS "mobileCinematicHigh",
            vi.mobile_cinematic_low AS "mobileCinematicLow",
            vi.video_still AS "videoStill",
            vi.thumbnail,
            vi.url,
            row_number() OVER (
              PARTITION BY vi.video_id
              ORDER BY vi.created_at ASC
            ) AS hydration_rank
          FROM video_image vi
          WHERE vi.video_id IN (${Prisma.join(videoIds)})
            AND vi.deleted_at IS NULL
        ) ranked
        WHERE ranked.hydration_rank <= ${HYDRATION_IMAGES_PER_VIDEO}
        ORDER BY ranked."videoId", ranked.hydration_rank
      `,
      ),
      recordSearchDbTiming(
        timing,
        "hydration.videoDub.query",
        () =>
          prisma.$queryRaw<HydrationDubRow[]>`
        SELECT
          ranked."videoId",
          ranked."languageId",
          ranked.duration,
          ranked."playbackId"
        FROM (
          SELECT
            vd.video_id AS "videoId",
            vd.language_id AS "languageId",
            vd.duration,
            mv.playback_id AS "playbackId",
            row_number() OVER (
              PARTITION BY vd.video_id
              ORDER BY vd.duration DESC, vd.id ASC
            ) AS hydration_rank
          FROM video_dub vd
          LEFT JOIN mux_video mv ON mv.id = vd.mux_video_id
          WHERE vd.video_id IN (${Prisma.join(videoIds)})
            AND vd.published = true
            AND vd.hls IS NOT NULL
            AND vd.deleted_at IS NULL
            AND vd.duration > 0
        ) ranked
        WHERE ranked.hydration_rank <= ${HYDRATION_DUBS_PER_VIDEO}
        ORDER BY ranked."videoId", ranked.hydration_rank
      `,
      ),
      recordSearchDbTiming(
        timing,
        "hydration.videoChildCount.query",
        () =>
          prisma.$queryRaw<HydrationChildCountRow[]>`
        SELECT
          vr.parent_id AS "videoId",
          COUNT(*)::int AS "childCount"
        FROM video_relation vr
        JOIN video child
          ON child.id = vr.child_id
          AND child.deleted_at IS NULL
        WHERE vr.parent_id IN (${Prisma.join(videoIds)})
          AND EXISTS (
            SELECT 1
            FROM video_locale child_locale
            WHERE child_locale.video_id = child.id
              AND child_locale.status = 'published'
              AND child_locale.deleted_at IS NULL
          )
        GROUP BY vr.parent_id
      `,
      ),
    ])

  const localesByVideoId = groupByVideoId(localeRows)
  const imagesByVideoId = groupByVideoId(imageRows)
  const dubsByVideoId = groupByVideoId(dubRows)
  const childCountsByVideoId = new Map(
    childCountRows.map((row) => [row.videoId, toChildCount(row.childCount)]),
  )

  return baseRows.map((row) => ({
    ...row,
    locales: localesByVideoId.get(row.id) ?? [],
    images: imagesByVideoId.get(row.id) ?? [],
    dubs: dubsByVideoId.get(row.id) ?? [],
    childCount: childCountsByVideoId.get(row.id) ?? 0,
  }))
}

/**
 * Card display hydration. Given the final page of video-type results,
 * batch-load card metadata with bounded, timed reads and return a new array
 * with display fields filled in:
 *
 * - public snippet from VideoLocale description/snippet
 * - imageUrl from VideoImage variants
 * - playbackId fallback from a playable Mux-backed dub
 * - label, primary playable dub duration, and child count
 *
 * Experience results pass through untouched.
 *
 * Why a post-mapping pass instead of fetching the data inline in each
 * retriever: the retrievers project tightly via `$queryRaw` for index
 * use; adding extra display fields per retriever would either duplicate the
 * LATERALs across 4+ SQL paths or force a UNION shape change. A small set
 * of bounded, parallel reads after pagination is O(page-size) — at most
 * ~50 rows for MAX_LIMIT — and keeps the retriever SQL read paths unchanged.
 *
 * Returns a NEW array (not mutating the input). Soft-deleted-mid-search
 * rows pass through with null pill fields — they keep title/slug from
 * the retriever's snapshot but won't surface a count or duration. The
 * narrow race window (~10ms) and the cost of coupling every test
 * fixture to per-id hydration stubs argues against dropping; if the
 * UX of "card-then-404" becomes meaningful, switch to a drop here.
 */
async function hydrateCardDisplayFields(
  prisma: PrismaClient,
  results: SearchResult[],
  locale: string,
  logger?: { error: (msg: string) => void },
  timing?: SearchTimingRecorder,
): Promise<SearchResult[]> {
  const videoIds = results.filter((r) => r.type === "video").map((r) => r.id)
  if (videoIds.length === 0) return results

  // Hydration data is display-only — a card renders without it. A Prisma
  // error here must NOT take the search endpoint down. Catch, log, and pass
  // through the pre-hydration array; consumers see a search response with
  // sparse card metadata rather than HTTP 503 for the whole request.
  let rows: HydrationDataRow[]
  try {
    rows = await loadHydrationDataRows(prisma, videoIds, locale, timing)
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
      snippet: string | null
      imageUrl: string | null
      playbackId: string | null
      label: VideoLabel | null
      durationSeconds: number | null
      childCount: number
    }
  >()
  for (const row of rows) {
    // Pick the primary-language dub when available; otherwise the
    // longest-duration playable dub. The hydration query sorts dubs by
    // duration descending with a stable ID tie-breaker. `duration` is
    // already in seconds (Int?); the millisecond column on VideoDub uses
    // BigInt and isn't needed for pill display where second precision is
    // the right fidelity.
    const primaryDub = row.primaryLanguageId
      ? row.dubs.find((d) => d.languageId === row.primaryLanguageId)
      : undefined
    const durationDub = primaryDub ?? row.dubs[0] ?? null
    const playbackDub =
      (nonEmptyString(primaryDub?.playbackId) != null
        ? primaryDub
        : undefined) ??
      row.dubs.find((d) => nonEmptyString(d.playbackId) != null) ??
      durationDub
    hydration.set(row.id, {
      snippet: pickLocalizedSnippet(row.locales),
      imageUrl: pickImageUrl(row.images),
      playbackId: nonEmptyString(playbackDub?.playbackId),
      label: row.label,
      durationSeconds: durationDub?.duration ?? null,
      childCount: row.childCount,
    })
  }

  return results.map((r) => {
    if (r.type !== "video") return r
    const h = hydration.get(r.id)
    if (h == null) return r
    return {
      ...r,
      snippet: h.snippet ?? r.snippet,
      imageUrl: nonEmptyString(r.imageUrl) ?? h.imageUrl,
      playbackId: nonEmptyString(r.playbackId) ?? h.playbackId,
      label: h.label,
      durationSeconds: h.durationSeconds,
      childCount: h.childCount,
    }
  })
}

function pickLocalizedSnippet(
  locales:
    | readonly ({
        description?: string | null
        snippet?: string | null
      } | null)[]
    | undefined,
): string | null {
  const locale = locales?.[0]
  return nonEmptyString(locale?.description) ?? nonEmptyString(locale?.snippet)
}

function pickImageUrl(
  images:
    | readonly ({
        mobileCinematicHigh?: string | null
        mobileCinematicLow?: string | null
        videoStill?: string | null
        thumbnail?: string | null
        url?: string | null
      } | null)[]
    | undefined,
): string | null {
  const priorities = [
    "mobileCinematicHigh",
    "mobileCinematicLow",
    "videoStill",
    "thumbnail",
    "url",
  ] as const

  for (const field of priorities) {
    for (const image of images ?? []) {
      const value = nonEmptyString(image?.[field])
      if (value != null) return value
    }
  }
  return null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  private readonly embedderRecordsHealth: boolean
  private readonly logger: {
    error: (message: string) => void
    warn: (message: string) => void
  }

  constructor(deps: HybridSearchServiceDeps) {
    this.prisma = deps.prisma
    this.embedder = deps.embedder ?? defaultEmbedder
    this.embedderRecordsHealth = deps.embedder == null
    this.logger = deps.logger ?? {
      error: (message: string) => console.error(message),
      warn: (message: string) => console.warn(message),
    }
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    const { response } = await this.searchWithTrace(params)
    return response
  }

  async searchWithTrace(params: SearchParams): Promise<SearchWithTraceResult> {
    const totalStartedAt = nowMs()
    const timing = new SearchTimingRecorder()
    const { query, locale } = params

    // Decode the opt-in pipeline mode. Unknown values warn-and-fall-back
    // to "hybrid" without throwing — same contract REST + GraphQL
    // surface to clients. Computed once per call so the warn log fires
    // at most once.
    const pipelineMode = normalizeMode(params.mode, this.logger, {
      allowInternalEvalModes: params.allowInternalEvalModes,
    })
    const semanticOnly = pipelineMode === "semantic-only"
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

    // Step 1: Prepare retrieval wrappers before embedding. Keyword-first
    // video lexical retrievers do not need the query embedding, so they
    // can start while the embedding provider is still in flight.
    type Retrieval = {
      label: string
      promise: Promise<RankedItem[]>
    }
    const retrievals: Retrieval[] = []
    const retrieverTimings = new Map<string, SearchRetrieverTiming>()
    const retrievalIntervals: SearchTimingInterval[] = []
    const skippedRetrieval = (label: string): Promise<RankedItem[]> => {
      retrieverTimings.set(label, {
        label,
        status: "skipped",
        elapsedMs: 0,
        resultCount: 0,
      })
      return Promise.resolve([])
    }
    const timedRetrieval = (
      label: string,
      run: () => Promise<RankedItem[]>,
    ): Promise<RankedItem[]> => {
      const startedAt = nowMs()
      return Promise.resolve()
        .then(run)
        .then(
          (value) => {
            const endedAt = nowMs()
            retrievalIntervals.push({ startedAt, endedAt })
            retrieverTimings.set(label, {
              label,
              status: "fulfilled",
              elapsedMs: boundedMs(endedAt - startedAt),
              resultCount: value.length,
            })
            return value
          },
          (error) => {
            const endedAt = nowMs()
            retrievalIntervals.push({ startedAt, endedAt })
            retrieverTimings.set(label, {
              label,
              status: "rejected",
              elapsedMs: boundedMs(endedAt - startedAt),
              resultCount: 0,
            })
            throw error
          },
        )
    }

    const earlyKeywordFirstRetrievals: Retrieval[] = []
    if (wantsVideos && pipelineMode === "keyword-first") {
      // Start the three-list lexical stack before embedding resolves.
      // Attaching allSettled immediately prevents a fast DB rejection
      // from surfacing as an unhandled promise rejection while embedding
      // is still pending.
      earlyKeywordFirstRetrievals.push(
        {
          label: "keyword-weighted-video",
          promise: timedRetrieval(
            "keyword-weighted-video",
            () =>
              searchByKeywordWeighted(
                this.prisma,
                {
                  query,
                  locale,
                  limit: overfetchLimit,
                },
                timing,
              ) as Promise<RankedItem[]>,
          ),
        },
        {
          label: "trigram-video",
          promise: timedRetrieval(
            "trigram-video",
            () =>
              searchByTrigram(
                this.prisma,
                {
                  query,
                  locale,
                  limit: overfetchLimit,
                },
                timing,
              ) as Promise<RankedItem[]>,
          ),
        },
        {
          label: "exact-title-video",
          promise: timedRetrieval(
            "exact-title-video",
            () =>
              searchByExactTitle(
                this.prisma,
                {
                  query,
                  locale,
                  limit: overfetchLimit,
                },
                timing,
              ) as Promise<RankedItem[]>,
          ),
        },
      )
    }
    const earlyRetrievalOutcomes = Promise.allSettled(
      earlyKeywordFirstRetrievals.map((r) => r.promise),
    )

    // Step 2: Embed the user's query. Degrade gracefully if the
    // provider is unavailable — keyword search alone still returns
    // useful results. Failures are logged at error level (a silent
    // warn let feat-097 hide in production for days) and tracked via
    // process-local counters the health probe exposes.
    let queryEmbeddingText: string | null = null
    let embeddingFailed = false
    let embeddingMs = 0
    const embeddingStartedAt = nowMs()
    if (!this.embedderRecordsHealth) recordAttempt()
    try {
      const vector = await this.embedder(query)
      queryEmbeddingText = toPgvectorText(vector)
    } catch (error) {
      embeddingFailed = true
      if (!this.embedderRecordsHealth) recordFailure(error)
      const errorClass =
        error instanceof Error ? error.constructor.name : "UnknownError"
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(
        `[search] event=query_embedding_failure error_class=${errorClass} message=${message}`,
      )
    } finally {
      embeddingMs = elapsedMs(embeddingStartedAt)
    }

    // Step 3: Run embedding-gated retrieval in parallel. allSettled keeps
    // partial results when one retrieval fails (e.g. pgvector timeout but
    // keyword succeeds). Each retrieval is paired with a label so
    // outcomes can map back to their source for logging.
    if (wantsVideos) {
      // Semantic-video is shared by every embedding-backed pipeline.
      retrievals.push({
        label: "semantic-video",
        promise:
          queryEmbeddingText != null
            ? timedRetrieval(
                "semantic-video",
                () =>
                  searchVideoSemantic(
                    this.prisma,
                    {
                      queryEmbedding: queryEmbeddingText,
                      locale,
                      limit: overfetchLimit,
                    },
                    timing,
                  ) as Promise<RankedItem[]>,
              )
            : skippedRetrieval("semantic-video"),
      })

      if (pipelineMode === "keyword-first") {
        // Three-list lexical stack: phrase-aware weighted tsvector,
        // typo-tolerant trigram on title, and exact-token-in-title
        // (Algolia-like). The legacy R4 `searchVideoKeyword` is NOT
        // dispatched on this branch — its concatenated tsvector is
        // strictly weaker than the weighted one for this workload.
        // The keyword-first lexical promises were already started above
        // so they can overlap the embedding provider call.
        retrievals.push(...earlyKeywordFirstRetrievals)
      } else if (!semanticOnly) {
        // Hybrid path — UNCHANGED from R4. Byte-identity locked in by
        // hybrid-search.regression.test.ts.
        retrievals.push({
          label: "keyword-video",
          promise: timedRetrieval(
            "keyword-video",
            () =>
              searchVideoKeyword(
                this.prisma,
                {
                  query,
                  locale,
                  limit: overfetchLimit,
                },
                timing,
              ) as Promise<RankedItem[]>,
          ),
        })
      }
    }

    if (wantsExperiences) {
      retrievals.push({
        label: "semantic-experience",
        promise:
          queryEmbeddingText != null
            ? timedRetrieval(
                "semantic-experience",
                () =>
                  searchExperienceSemantic(
                    this.prisma,
                    {
                      queryEmbedding: queryEmbeddingText,
                      locale,
                      limit: overfetchLimit,
                    },
                    timing,
                  ) as Promise<RankedItem[]>,
              )
            : skippedRetrieval("semantic-experience"),
      })
      if (!semanticOnly) {
        retrievals.push({
          label: "keyword-experience",
          promise: timedRetrieval(
            "keyword-experience",
            () =>
              searchExperienceKeyword(
                this.prisma,
                {
                  query,
                  locale,
                  limit: overfetchLimit,
                },
                timing,
              ) as Promise<RankedItem[]>,
          ),
        })
      }
    }

    const settledRetrieval = (promise: Promise<RankedItem[]>) =>
      Promise.allSettled([promise]).then(([outcome]) => outcome!)
    const retrievalWaitStartedAt = nowMs()
    const outcomes = await Promise.all(
      retrievals.map((retrieval) => {
        const earlyIndex = earlyKeywordFirstRetrievals.indexOf(retrieval)
        return earlyIndex >= 0
          ? earlyRetrievalOutcomes.then((outcomes) => outcomes[earlyIndex]!)
          : settledRetrieval(retrieval.promise)
      }),
    )
    const retrievalWaitMs = elapsedMs(retrievalWaitStartedAt)
    const retrievalsMs = activeTimingIntervalsMs(retrievalIntervals)
    const failedRetrievers: string[] = []
    const lists = outcomes.map((outcome, i) =>
      this.unwrapOutcome(outcome, retrievals[i]!.label, failedRetrievers),
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

    // Step 4: Fuse ranked lists via RRF. Drop empty lists first — RRF
    // normalizes by dividing by the number of input lists, so empty
    // ones dilute scores from lists that did contribute.
    const nonEmptyLists = lists.filter((list) => list.length > 0)
    const fusionStartedAt = nowMs()
    const fused = fuseRankedLists(nonEmptyLists, RRF_K)
    const fusionMs = elapsedMs(fusionStartedAt)

    // Snapshot pre-cap fused scores so the debug payload can surface
    // both numbers (the cap mutates `result.score` in place).
    for (const result of fused) {
      const key = `${result.resultType}:${result.resultId}`
      const trace = debugByKey.get(key)
      if (trace != null) trace.fusedScore = result.score
    }

    // Step 4b: Semantic-dilution cap. Active only in keyword-first mode
    // and only when an exact-title hit exists. Halves the score of any
    // fused result whose ONLY contributing list was semantic AND whose
    // video core_id is not represented in the top-N keyword-side
    // core_ids. Hybrid mode never reaches this step.
    let dilutionCapMs = 0
    if (pipelineMode === "keyword-first" && isDilutionCapEnabled()) {
      const dilutionCapStartedAt = nowMs()
      applyDilutionCap(fused, labeledLists, query, debugByKey)
      dilutionCapMs = elapsedMs(dilutionCapStartedAt)
    }

    // Step 5: Dedup one extra result beyond the page window so we know
    // whether more results exist (drives hasMore without a full count
    // pass).
    const dedupeStartedAt = nowMs()
    const deduped = deduplicateResults(fused, offset + limit + 1)

    // Step 6: Paginate and map to API contract.
    const page = deduped.slice(offset, offset + limit)
    const hasMore = deduped.length > offset + limit
    const dedupeMs = elapsedMs(dedupeStartedAt)
    const mappingStartedAt = nowMs()
    const mapped = page.map((result) => {
      const base = mapToSearchResult(result)
      if (params.debug !== true) return base
      const key = `${result.resultType}:${result.resultId}`
      const trace = debugByKey.get(key)
      if (trace == null) return base
      return { ...base, debug: trace }
    })
    const mappingMs = elapsedMs(mappingStartedAt)

    // Hydrate card display fields for video results in one batched query.
    // Experience rows pass through untouched.
    const hydrationStartedAt = nowMs()
    const results = await hydrateCardDisplayFields(
      this.prisma,
      mapped,
      locale,
      this.logger,
      timing,
    )
    const hydrationMs = elapsedMs(hydrationStartedAt)

    const searchMode = queryEmbeddingText != null ? "hybrid" : "keyword-only"
    const contributingRetrievers = labeledLists
      .filter(({ list }) => list.length > 0)
      .map(({ label }) => label)
    const traceClasses: string[] = []
    if (embeddingFailed) traceClasses.push("query_embedding_failure")
    if (failedRetrievers.length > 0) traceClasses.push("retrieval_failure")
    const traceClass = traceClasses.length > 0 ? traceClasses.join("+") : "none"
    const response: SearchResponse = {
      results,
      hasMore,
      query,
      // queryEmbeddingText is non-null iff the embedding call succeeded
      // and semantic retrieval could run. If null, public modes assemble
      // from keyword retrieval alone; internal semantic-only returns an
      // empty degraded response without lexical fallback.
      searchMode,
    }
    const timings: SearchTimingSummary = {
      pipelineMode,
      totalMs: elapsedMs(totalStartedAt),
      embeddingMs,
      retrievalsMs,
      retrievalWaitMs,
      fusionMs,
      dilutionCapMs,
      dedupeMs,
      mappingMs,
      hydrationMs,
      retrievers: retrievals.flatMap((retrieval) => {
        const retrieverTiming = retrieverTimings.get(retrieval.label)
        return retrieverTiming == null ? [] : [retrieverTiming]
      }),
      db: timing.snapshotDbTimings(),
    }

    return {
      response,
      trace: {
        searchMode,
        resultCount: results.length,
        outcome: traceClass === "none" ? "success" : "degraded",
        traceClass,
        failedRetrievers,
        contributingRetrievers,
      },
      timings,
    }
  }

  private unwrapOutcome<T>(
    outcome: PromiseSettledResult<T[]>,
    label: string,
    failedRetrievers: string[],
  ): T[] {
    if (outcome.status === "fulfilled") return outcome.value
    failedRetrievers.push(label)
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
