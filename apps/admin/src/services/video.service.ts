// Video service — read-only in v1. Writes come via Core sync (Unit 10).
//
// Auth contract (consumer-migration U2 — 2026-05-11): `list`/`getById`/
// `getBySlug` are exposed via PUBLIC resolvers in
// `apps/admin/src/graphql/types/video.ts:316,332,346`; the resolver's
// `authScopes: { public: true }` is the sole auth wall — re-adding a
// service-layer `hasPermission` guard would 403 anonymous callers and
// breaks `video.service.test.ts:52`. `getByCoreId` is service-to-service
// only (Core sync internals) and keeps its guard.

import {
  Prisma,
  type LocaleStatus,
  type PrismaClient,
  type SourceTier,
  type VideoLabel,
  type VideoSource,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

/**
 * Dispatch-fields projection consumed by manager's admin-trigger
 * endpoints (feat-125). Each field is nullable so callers can decide
 * how to classify missing data — manager surfaces `validation_failed`
 * per-item when primary language or muxAssetId is null; subtitleUrl
 * is an optional fast path. Replaces the
 * Strapi `videos(filters: { coreId: { in } })` query manager used to
 * issue against cms.
 *
 * Wire-shape note: apps/manager/src/lib/admin-video-lookup.ts
 * declares a structurally-identical local `VideoForEnrichment` type
 * (manager consumes the GraphQL projection but isn't yet on
 * @forge/admin-graphql). The two must stay field-for-field in sync;
 * a drift surfaces at runtime only via the `graphql_error` envelope
 * branch on the manager side.
 */
export type VideoForEnrichment = {
  id: string
  coreId: string
  label: string | null
  primaryLanguageBcp47: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

export class VideoLookupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoLookupValidationError"
  }
}

/**
 * One distinct playable dub language available across a parent video's
 * children. Powers the `/series` page language picker via
 * `Video.childDubLanguages` without shipping every child's full dub list
 * (the ~45 MB / 137k-record trap that exceeds Next's `unstable_cache` 2 MB
 * ceiling on a 61-chapter × ~2,200-dub collection). Only the language
 * display fields are projected — the picker navigates by slug and never
 * touches a dub's id/hls/duration, so those are deliberately omitted to
 * keep the per-language payload minimal.
 */
export type ChildDubLanguageRow = {
  slug: string | null
  name: Prisma.JsonValue | null
  bcp47: string | null
}

/**
 * Maximum coreIds accepted in a single `getByCoreIds` call. Mirrors
 * the receiver-side cap in manager's `admin-trigger-route.ts` so the
 * contract is double-locked.
 */
export const VIDEOS_BY_CORE_IDS_MAX = 100
const VIDEOS_BY_CORE_IDS_STATEMENT_TIMEOUT_MS = 8_000
const VIDEOS_BY_CORE_IDS_TRANSACTION_TIMEOUT_MS = 9_000
const VIDEOS_BY_CORE_IDS_STATEMENT_TIMEOUT_SQL = `SET LOCAL statement_timeout = '${VIDEOS_BY_CORE_IDS_STATEMENT_TIMEOUT_MS}ms'`

const VIDEO_LABEL_SEARCH_TOKENS = {
  COLLECTION: ["collection"],
  EPISODE: ["episode"],
  FEATURE_FILM: ["feature film", "featurefilm", "film", "movie"],
  SEGMENT: ["segment"],
  SERIES: ["series"],
  SHORT_FILM: ["short film", "shortfilm", "short"],
  TRAILER: ["trailer"],
  BEHIND_THE_SCENES: ["behind the scenes", "behindthescenes", "behind scenes"],
} satisfies Record<VideoLabel, readonly string[]>

const VIDEO_SOURCE_SEARCH_TOKENS = {
  INTERNAL: ["internal"],
  YOUTUBE: ["youtube", "you tube"],
  CLOUDFLARE: ["cloudflare", "cloudflare stream"],
  MUX: ["mux"],
} satisfies Record<VideoSource, readonly string[]>

const SOURCE_TIER_SEARCH_TOKENS = {
  CORE: ["core", "core sync"],
  MANAGER: ["manager", "manual"],
} satisfies Record<SourceTier, readonly string[]>

const LOCALE_STATUS_SEARCH_TOKENS = {
  DRAFT: ["draft"],
  PUBLISHED: ["published", "publish"],
  ARCHIVED: ["archived", "archive"],
} satisfies Record<LocaleStatus, readonly string[]>

function normalizeSearchValue(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? ""
}

function comparableSearchValue(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "")
}

function containsSearch(value: string) {
  return { contains: value, mode: "insensitive" as const }
}

function enumSearchMatches<T extends string>(
  value: string,
  tokensByValue: Record<T, readonly string[]>,
) {
  const normalized = value.toLowerCase()
  const compact = comparableSearchValue(value)
  const loose = normalized.length >= 3

  return Object.entries(tokensByValue)
    .filter(([, tokens]) =>
      (tokens as readonly string[]).some((token) => {
        const normalizedToken = token.toLowerCase()
        const compactToken = comparableSearchValue(token)
        return loose
          ? normalizedToken.includes(normalized) ||
              normalized.includes(normalizedToken) ||
              compactToken.includes(compact) ||
              compact.includes(compactToken)
          : normalizedToken === normalized || compactToken === compact
      }),
    )
    .map(([key]) => key as T)
}

function integerSearchValue(value: string) {
  if (!/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function bigintSearchValue(value: string) {
  if (!/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function booleanSearchValue(value: string) {
  const normalized = value.toLowerCase()
  if (["true", "yes", "1"].includes(normalized)) return true
  if (["false", "no", "0"].includes(normalized)) return false
  return null
}

function dateSearchRange(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!dateOnly) {
    return { gte: parsed, lte: parsed }
  }

  const nextDay = new Date(parsed)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  return { gte: parsed, lt: nextDay }
}

function sourceTierSearchFilters(search: string) {
  const matches = enumSearchMatches(search, SOURCE_TIER_SEARCH_TOKENS)
  return matches.length > 0 ? { in: matches } : undefined
}

function languageSearchWhere(search: string): Prisma.LanguageWhereInput {
  const text = containsSearch(search)
  const sourceMatches = sourceTierSearchFilters(search)

  return {
    deletedAt: null,
    OR: [
      { id: text },
      { coreId: text },
      { bcp47: text },
      { iso3: text },
      { slug: text },
      { audioPreviewValue: text },
      ...(sourceMatches ? [{ source: sourceMatches }] : []),
    ],
  }
}

function videoSearchWhere(rawSearch: string | null | undefined) {
  const search = normalizeSearchValue(rawSearch)
  const where: Prisma.VideoWhereInput = { deletedAt: null }
  if (!search) return where

  const text = containsSearch(search)
  const labelMatches = enumSearchMatches(search, VIDEO_LABEL_SEARCH_TOKENS)
  const videoSourceMatches = enumSearchMatches(
    search,
    VIDEO_SOURCE_SEARCH_TOKENS,
  )
  const sourceMatches = sourceTierSearchFilters(search)
  const localeStatusMatches = enumSearchMatches(
    search,
    LOCALE_STATUS_SEARCH_TOKENS,
  )
  const integer = integerSearchValue(search)
  const bigint = bigintSearchValue(search)
  const boolean = booleanSearchValue(search)
  const dateRange = dateSearchRange(search)

  return {
    deletedAt: null,
    OR: [
      { id: text },
      { coreId: text },
      { slug: text },
      { primaryLanguageId: text },
      { originId: text },
      ...(sourceMatches ? [{ source: sourceMatches }] : []),
      ...(labelMatches.length > 0 ? [{ label: { in: labelMatches } }] : []),
      ...(videoSourceMatches.length > 0
        ? [{ videoSource: { in: videoSourceMatches } }]
        : []),
      ...(boolean === null
        ? []
        : [{ locked: boolean }, { noIndex: boolean }, { aiMetadata: boolean }]),
      ...(dateRange
        ? [
            { publishedAt: dateRange },
            { syncedAt: dateRange },
            { createdAt: dateRange },
            { updatedAt: dateRange },
          ]
        : []),
      { primaryLanguage: { is: languageSearchWhere(search) } },
      {
        origin: {
          is: {
            deletedAt: null,
            OR: [
              { id: text },
              { coreId: text },
              { name: text },
              { description: text },
              ...(sourceMatches ? [{ source: sourceMatches }] : []),
              ...(dateRange
                ? [
                    { syncedAt: dateRange },
                    { createdAt: dateRange },
                    { updatedAt: dateRange },
                  ]
                : []),
            ],
          },
        },
      },
      {
        locales: {
          some: {
            OR: [
              { id: text },
              { locale: text },
              { title: text },
              { description: text },
              { snippet: text },
              { imageAlt: text },
              ...(localeStatusMatches.length > 0
                ? [{ status: { in: localeStatusMatches } }]
                : []),
              ...(dateRange
                ? [
                    { publishedAt: dateRange },
                    { createdAt: dateRange },
                    { updatedAt: dateRange },
                  ]
                : []),
            ],
          },
        },
      },
      {
        dubs: {
          some: {
            OR: [
              { id: text },
              { coreId: text },
              { slug: text },
              { hls: text },
              { dash: text },
              { share: text },
              { brightcoveId: text },
              { videoEditionId: text },
              { muxVideoId: text },
              { languageId: text },
              ...(sourceMatches ? [{ source: sourceMatches }] : []),
              ...(integer === null
                ? []
                : [{ duration: integer }, { version: integer }]),
              ...(bigint === null ? [] : [{ lengthInMilliseconds: bigint }]),
              ...(boolean === null
                ? []
                : [
                    { downloadable: boolean },
                    { published: boolean },
                    { aiGenerated: boolean },
                  ]),
              ...(dateRange
                ? [
                    { syncedAt: dateRange },
                    { createdAt: dateRange },
                    { updatedAt: dateRange },
                  ]
                : []),
              { language: { is: languageSearchWhere(search) } },
              {
                videoEdition: {
                  is: {
                    deletedAt: null,
                    OR: [
                      { id: text },
                      { coreId: text },
                      { name: text },
                      ...(sourceMatches ? [{ source: sourceMatches }] : []),
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      {
        images: {
          some: {
            OR: [
              { id: text },
              { coreId: text },
              { url: text },
              { aspectRatio: text },
              { mobileCinematicHigh: text },
              { mobileCinematicLow: text },
              { mobileCinematicVeryLow: text },
              { thumbnail: text },
              { videoStill: text },
              { blurhash: text },
              { kind: text },
              ...(sourceMatches ? [{ source: sourceMatches }] : []),
              ...(integer === null
                ? []
                : [{ width: integer }, { height: integer }]),
              ...(dateRange
                ? [
                    { syncedAt: dateRange },
                    { createdAt: dateRange },
                    { updatedAt: dateRange },
                  ]
                : []),
            ],
          },
        },
      },
    ],
  } satisfies Prisma.VideoWhereInput
}

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    query,
  }: {
    input: { limit?: number; offset?: number; search?: string }
    query: object
  }) {
    return this.prisma.video.findMany({
      ...query,
      where: videoSearchWhere(raw.search),
      orderBy: { updatedAt: "desc" },
      take: Math.min(raw.limit ?? 50, 200),
      skip: raw.offset ?? 0,
    })
  }

  async countActive(search?: string) {
    return this.prisma.video.count({ where: videoSearchWhere(search) })
  }

  async getById({ id, query }: { id: string; query: object }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { id, deletedAt: null },
    })
  }

  async getBySlug({ slug, query }: { slug: string; query: object }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { slug, deletedAt: null },
    })
  }

  async getByCoreId({
    coreId,
    user,
    query,
  }: {
    coreId: string
    user: Principal | null
    query: object
  }) {
    // Service-to-service only (Core sync). Auth wall lives here, not at a resolver.
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: { coreId, deletedAt: null },
    })
  }

  /**
   * Batched coreId → dispatch-fields lookup. Replaces the Strapi
   * `videos(filters: { coreId: { in } })` call that lived in
   * `apps/manager/src/lib/admin-trigger-route.ts` before feat-125.
   * Server-side picker — admin owns the "best primary-language
   * variant + subtitle" semantics so manager doesn't re-implement.
   *
   * Picker scores subtitles by `(primary ? 0 : 1) + (aiGenerated ? 1 : 0)`,
   * lower wins — preferring `primary=true` non-AI before falling back
   * to any candidate in the primary language. Mirrors the original
   * Strapi-shape picker semantics.
   *
   * Auth is enforced at the resolver via `read:video-metadata`; this
   * method is service-internal and does not re-check (matches the
   * `list`/`getById`/`getBySlug` posture).
   */
  async getByCoreIds({
    coreIds,
  }: {
    coreIds: readonly string[]
  }): Promise<VideoForEnrichment[]> {
    if (coreIds.length === 0) return []
    if (coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
      throw new VideoLookupValidationError(
        `coreIds.length=${coreIds.length} exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      )
    }

    let rows: VideoForEnrichmentRow[]
    let transactionDurationMs: number | null = null
    let sqlDurationMs: number | null = null
    const startedAt = Date.now()
    try {
      rows = await this.prisma.$transaction(
        async (tx) => {
          const transactionStartedAt = Date.now()
          await tx.$executeRawUnsafe(VIDEOS_BY_CORE_IDS_STATEMENT_TIMEOUT_SQL)

          const sqlStartedAt = Date.now()
          const result = await tx.$queryRaw<VideoForEnrichmentRow[]>`
            SELECT
              v.id,
              v.core_id AS "coreId",
              v.label::text AS label,
              primary_language.bcp47 AS "primaryLanguageBcp47",
              primary_mux.asset_id AS "muxAssetId",
              primary_subtitle.vtt_src AS "subtitleUrl"
            FROM video v
            LEFT JOIN language primary_language
              ON primary_language.id = v.primary_language_id
              AND primary_language.deleted_at IS NULL
            LEFT JOIN LATERAL (
              SELECT mux_video.asset_id
              FROM video_dub dub
              JOIN language dub_language
                ON dub_language.id = dub.language_id
                AND dub_language.deleted_at IS NULL
              JOIN mux_video
                ON mux_video.id = dub.mux_video_id
                AND mux_video.deleted_at IS NULL
              WHERE dub.video_id = v.id
                AND dub.deleted_at IS NULL
                AND dub_language.bcp47 = primary_language.bcp47
                AND mux_video.asset_id IS NOT NULL
                AND mux_video.asset_id <> ''
              ORDER BY dub.published DESC NULLS LAST, dub.updated_at DESC
              LIMIT 1
            ) primary_mux ON TRUE
            LEFT JOIN LATERAL (
              SELECT subtitle.vtt_src
              FROM video_subtitle subtitle
              JOIN language subtitle_language
                ON subtitle_language.id = subtitle.language_id
                AND subtitle_language.deleted_at IS NULL
              WHERE subtitle.video_id = v.id
                AND subtitle.deleted_at IS NULL
                AND subtitle_language.bcp47 = primary_language.bcp47
                AND subtitle.vtt_src IS NOT NULL
                AND subtitle.vtt_src <> ''
              ORDER BY
                (CASE WHEN subtitle.primary THEN 0 ELSE 1 END) +
                (CASE WHEN subtitle.ai_generated THEN 1 ELSE 0 END) ASC,
                subtitle.updated_at DESC
              LIMIT 1
            ) primary_subtitle ON TRUE
            WHERE v.core_id IN (${Prisma.join([...coreIds])})
              AND v.deleted_at IS NULL
          `
          sqlDurationMs = Date.now() - sqlStartedAt
          transactionDurationMs = Date.now() - transactionStartedAt
          return result
        },
        { timeout: VIDEOS_BY_CORE_IDS_TRANSACTION_TIMEOUT_MS },
      )
    } catch (error) {
      logVideoLookupFailure(coreIds.length, Date.now() - startedAt, error)
      throw error
    }
    logSlowVideoLookup(coreIds.length, Date.now() - startedAt, {
      rowCount: rows.length,
      transactionDurationMs,
      sqlDurationMs,
    })

    return rows.map((video): VideoForEnrichment => {
      return {
        id: video.id,
        coreId: video.coreId,
        // Normalize to camelCase wire shape (`featureFilm`,
        // `shortFilm`, …) so manager's downstream scene-analysis
        // prompt input matches the pre-feat-125 Strapi-shape
        // exactly. Prisma exposes the enum's TS identifier
        // (`FEATURE_FILM`) but the DB-stored value (per `@map` in
        // schema.prisma) is camelCase; manager's existing pipeline
        // tests pass `videoLabel: "shortFilm"`-style fixtures, so
        // any drift here changes the LLM prompt content.
        label: snakeUpperToCamel(video.label),
        primaryLanguageBcp47: video.primaryLanguageBcp47,
        muxAssetId: video.muxAssetId,
        subtitleUrl: video.subtitleUrl,
      }
    })
  }

  /**
   * Distinct playable dub languages available across this video's children.
   * Empty for videos without children.
   *
   * Postgres `DISTINCT ON (language_id)` (Prisma `distinct` + a leading
   * `languageId` orderBy) collapses the per-language fan-out at the DB so
   * the payload is bounded by the language count (~thousands), not
   * children × dubs (~137k for the Jesus film). Playable = published + has
   * HLS + not soft-deleted, in a non-deleted language with a slug — so the
   * returned set needs no client-side playability re-filter. Only the
   * language display fields are selected; the picker navigates by slug.
   *
   * Child visibility mirrors `videoChildrenFilter`
   * (`graphql/types/video.ts`): EDITOR/ADMIN see every non-deleted child;
   * everyone else sees only children with a PUBLISHED locale. Keeps the
   * picker's language set aligned with the chapters the carousel renders.
   *
   * Auth is enforced at the resolver (`Video` is PUBLIC since U2); this
   * method is service-internal and does not re-check.
   */
  async getChildDubLanguages({
    videoId,
    user,
  }: {
    videoId: string
    user: Principal | null
  }): Promise<ChildDubLanguageRow[]> {
    const childVisibility: Prisma.VideoWhereInput = isEditorOrAdmin(user)
      ? { deletedAt: null }
      : { deletedAt: null, locales: { some: { status: "PUBLISHED" } } }

    const dubs = await this.prisma.videoDub.findMany({
      where: {
        deletedAt: null,
        published: true,
        hls: { not: null },
        languageId: { not: null },
        language: { slug: { not: null }, deletedAt: null },
        video: {
          ...childVisibility,
          // Children of `videoId`: this dub's video sits on the CHILD side
          // of a VideoRelation whose parent is `videoId`.
          parents: { some: { parentId: videoId } },
        },
      },
      distinct: ["languageId"],
      // Leading `languageId` makes Prisma emit SQL `DISTINCT ON (language_id)` —
      // one row per language. Which dub wins is irrelevant: only the (shared)
      // language fields are projected.
      orderBy: [{ languageId: "asc" }],
      select: {
        language: { select: { slug: true, name: true, bcp47: true } },
      },
    })

    return dubs.map((dub) => ({
      slug: dub.language?.slug ?? null,
      name: dub.language?.name ?? null,
      bcp47: dub.language?.bcp47 ?? null,
    }))
  }
}

type VideoForEnrichmentRow = VideoForEnrichment

function logSlowVideoLookup(
  coreIdCount: number,
  durationMs: number,
  details: {
    rowCount: number
    transactionDurationMs: number | null
    sqlDurationMs: number | null
  },
): void {
  if (durationMs < 500) return
  console.warn(
    `[videosByCoreIds] event=lookup.slow coreIdCount=${coreIdCount} rowCount=${details.rowCount} durationMs=${durationMs} transactionDurationMs=${formatMetric(details.transactionDurationMs)} sqlDurationMs=${formatMetric(details.sqlDurationMs)}`,
  )
}

function logVideoLookupFailure(
  coreIdCount: number,
  durationMs: number,
  error: unknown,
): void {
  console.warn(
    `[videosByCoreIds] event=lookup.failed coreIdCount=${coreIdCount} durationMs=${durationMs} ${formatLookupError(error)}`,
  )
}

function formatMetric(value: number | null): string {
  return value == null ? "unknown" : String(value)
}

function formatLookupError(error: unknown): string {
  if (!(error instanceof Error)) return "errorName=UnknownError"

  const maybeCode = (error as Error & { code?: unknown }).code
  const code = typeof maybeCode === "string" ? ` errorCode=${maybeCode}` : ""
  return `errorName=${error.name}${code}`
}

/**
 * Convert Prisma's TS enum identifier (e.g. `FEATURE_FILM`) into
 * the camelCase wire shape Strapi previously emitted (e.g.
 * `featureFilm`). Returns null for null input.
 *
 * Defensive shape: input that is NOT UPPER_SNAKE_CASE passes
 * through unchanged. Prisma's TS enum identifier is guaranteed
 * UPPER_SNAKE today, but a future Prisma config change (e.g.,
 * disabling enum-identifier mapping so the DB-stored camelCase
 * value surfaces directly) would otherwise be silently lowercased
 * by the unconditional `.toLowerCase()` — `featureFilm` →
 * `featurefilm` is a real wire-shape regression that the regex
 * step alone cannot fix.
 */
function snakeUpperToCamel(value: string | null): string | null {
  if (value == null) return null
  if (!/^[A-Z][A-Z_]*$/.test(value)) return value
  return value
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
