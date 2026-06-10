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
  targetLocale: string | null
  primaryLanguageBcp47: string | null
  languageBcp47: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

export type VideoMapperCatalogMediaSourceType =
  | "DOWNLOAD"
  | "HLS"
  | "DASH"
  | "NONE"

export const VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS = [
  "dub_deleted",
  "video_deleted",
  "video_no_index",
  "video_unpublished",
  "dub_unpublished",
  "language_missing",
  "language_deleted",
  "edition_deleted",
  "media_missing",
] as const

export type VideoMapperCatalogNonIndexableReason =
  (typeof VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS)[number]

export type VideoMapperCatalogItem = {
  coreId: string
  sourceTitle: string
  sourceTitleLocale: string | null
  videoVariantId: string
  adminVideoId: string
  adminDubId: string
  languageId: string | null
  languageSlug: string | null
  locale: string | null
  editionCoreId: string | null
  editionName: string | null
  durationSeconds: number | null
  lengthInMilliseconds: string | null
  hlsUrl: string | null
  dashUrl: string | null
  // Diagnostic only in YTM-002: mapper MediaSourceType has no SHARE value.
  shareUrl: string | null
  downloadUrl: string | null
  downloadQuality: string | null
  downloadWidth: number | null
  downloadHeight: number | null
  mediaSourceType: VideoMapperCatalogMediaSourceType
  mediaSourceUrl: string | null
  videoPublished: boolean
  dubPublished: boolean
  videoNoIndex: boolean
  videoDeleted: boolean
  dubDeleted: boolean
  deletedAt: string | null
  indexable: boolean
  nonIndexableReason: VideoMapperCatalogNonIndexableReason | null
}

export type VideoMapperCatalogPageInfo = {
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
}

export type VideoMapperCatalogConnection = {
  nodes: VideoMapperCatalogItem[]
  pageInfo: VideoMapperCatalogPageInfo
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
export const VIDEO_MAPPER_CATALOG_DEFAULT_PAGE_SIZE = 100
export const VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE = 250
const VIDEO_MAPPER_CATALOG_CURSOR_PREFIX = "video-dub:"
const VIDEO_MAPPER_CATALOG_STATEMENT_TIMEOUT_MS = 10_000
const VIDEO_MAPPER_CATALOG_TRANSACTION_TIMEOUT_MS = 11_000
const VIDEO_MAPPER_CATALOG_STATEMENT_TIMEOUT_SQL = `SET LOCAL statement_timeout = '${VIDEO_MAPPER_CATALOG_STATEMENT_TIMEOUT_MS}ms'`

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

type VideoListCategory =
  | "all"
  | "collections"
  | "features"
  | "shortFilms"
  | "series"
type VideoListSort = "recent" | "oldest" | "created" | "createdOldest"

type VideoListInput = {
  category?: VideoListCategory
  collection?: string
  language?: string
  limit?: number
  offset?: number
  search?: string
  sort?: VideoListSort
}

const VIDEO_CATEGORY_LABELS = {
  collections: ["COLLECTION"],
  features: ["FEATURE_FILM"],
  shortFilms: ["SHORT_FILM"],
  series: ["SERIES"],
} satisfies Record<Exclude<VideoListCategory, "all">, readonly VideoLabel[]>

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

function videoCategoryWhere(
  category: VideoListCategory | null | undefined,
): Prisma.VideoWhereInput | null {
  if (!category || category === "all") return null
  const labels = VIDEO_CATEGORY_LABELS[category]
  return labels ? { label: { in: [...labels] } } : null
}

function videoLanguageWhere(
  rawLanguage: string | null | undefined,
): Prisma.VideoWhereInput | null {
  const language = normalizeSearchValue(rawLanguage)
  if (!language) return null

  return {
    dubs: {
      some: {
        deletedAt: null,
        language: { is: languageSearchWhere(language) },
      },
    },
  } satisfies Prisma.VideoWhereInput
}

function videoIdentifierWhere(identifier: string): Prisma.VideoWhereInput {
  return {
    OR: [{ id: identifier }, { coreId: identifier }, { slug: identifier }],
  } satisfies Prisma.VideoWhereInput
}

function videoCollectionWhere(
  rawCollection: string | null | undefined,
): Prisma.VideoWhereInput | null {
  const collection = normalizeSearchValue(rawCollection)
  if (!collection) return null

  return {
    parents: {
      some: {
        parent: {
          deletedAt: null,
          ...videoIdentifierWhere(collection),
        },
      },
    },
  } satisfies Prisma.VideoWhereInput
}

function videoListWhere(
  input: Pick<
    VideoListInput,
    "category" | "collection" | "language" | "search"
  >,
) {
  const filters = [
    videoSearchWhere(input.search),
    videoCategoryWhere(input.category),
    videoCollectionWhere(input.collection),
    videoLanguageWhere(input.language),
  ].filter((filter): filter is Prisma.VideoWhereInput => filter != null)

  return filters.length === 1
    ? filters[0]
    : ({ AND: filters } satisfies Prisma.VideoWhereInput)
}

function videoListOrderBy(
  sort: VideoListSort | null | undefined,
):
  | Prisma.VideoOrderByWithRelationInput
  | Prisma.VideoOrderByWithRelationInput[] {
  if (sort === "oldest") {
    return [{ updatedAt: "asc" }, { createdAt: "asc" }]
  }

  if (sort === "created") {
    return [{ createdAt: "desc" }, { updatedAt: "desc" }]
  }

  if (sort === "createdOldest") {
    return [{ createdAt: "asc" }, { updatedAt: "asc" }]
  }

  return { updatedAt: "desc" }
}

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  async list({ input: raw, query }: { input: VideoListInput; query: object }) {
    return this.prisma.video.findMany({
      ...query,
      where: videoListWhere(raw),
      orderBy: videoListOrderBy(raw.sort),
      take: Math.min(raw.limit ?? 50, 200),
      skip: raw.offset ?? 0,
    })
  }

  async countActive(
    input?:
      | string
      | Pick<VideoListInput, "category" | "collection" | "language" | "search">,
  ) {
    const normalizedInput =
      typeof input === "string" ? { search: input } : (input ?? {})
    return this.prisma.video.count({ where: videoListWhere(normalizedInput) })
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

  // Fetch a single VideoDub by id so consumers can lazily load one dub's
  // downloads + subtitles instead of projecting every dub up front (mobile's
  // lean watch screen). PUBLIC — same posture as getById/getBySlug. Visibility
  // mirrors reaching the dub via `videoBySlug(slug){ dubs }`: the dub and its
  // parent video must both be non-deleted (the `dubs` relation filters
  // `deletedAt: null`; the video query gates `deletedAt: null`).
  async getDubById({ id, query }: { id: string; query: object }) {
    return this.prisma.videoDub.findFirst({
      ...query,
      where: { id, deletedAt: null, video: { deletedAt: null } },
    })
  }

  async listMapperCatalogVariants({
    first,
    after,
  }: {
    first?: number | null
    after?: string | null
  }): Promise<VideoMapperCatalogConnection> {
    const pageSize = normalizeMapperCatalogPageSize(first)
    const afterId = decodeMapperCatalogCursor(after)
    await this.assertMapperCatalogCursorExists(afterId)
    const cursorFilter =
      afterId == null ? Prisma.empty : Prisma.sql`WHERE d.id > ${afterId}::text`
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(VIDEO_MAPPER_CATALOG_STATEMENT_TIMEOUT_SQL)
        return tx.$queryRaw<VideoMapperCatalogItem[]>`
      WITH paged_dubs AS (
        SELECT d.*
        FROM video_dub d
        ${cursorFilter}
        ORDER BY d.id ASC
        LIMIT ${pageSize + 1}
      ),
      paged_video_ids AS (
        SELECT DISTINCT d.video_id
        FROM paged_dubs d
      ),
      published_state_by_video AS (
        SELECT
          paged_video_ids.video_id,
          EXISTS (
            SELECT 1
            FROM video_locale published_locale
            WHERE published_locale.video_id = paged_video_ids.video_id
              AND published_locale.deleted_at IS NULL
              AND published_locale.status = 'published'
          ) AS video_published
        FROM paged_video_ids
      ),
      selected_title_by_video AS (
        SELECT DISTINCT ON (locale.video_id)
          locale.video_id,
          locale.title,
          locale.locale
        FROM video_locale locale
        JOIN paged_video_ids
          ON paged_video_ids.video_id = locale.video_id
        WHERE locale.deleted_at IS NULL
          AND NULLIF(locale.title, '') IS NOT NULL
        ORDER BY
          locale.video_id ASC,
          CASE WHEN locale.status = 'published' THEN 0 ELSE 1 END ASC,
          CASE WHEN locale.locale = 'en' THEN 0 ELSE 1 END ASC,
          locale.locale ASC NULLS LAST,
          locale.id ASC
      )
      SELECT
        v.core_id AS "coreId",
        COALESCE(selected_title.title, v.slug, v.core_id) AS "sourceTitle",
        selected_title.locale AS "sourceTitleLocale",
        d.core_id AS "videoVariantId",
        v.id AS "adminVideoId",
        d.id AS "adminDubId",
        language.core_id AS "languageId",
        language.slug AS "languageSlug",
        language.bcp47 AS "locale",
        edition.core_id AS "editionCoreId",
        edition.name AS "editionName",
        d.duration AS "durationSeconds",
        d.length_in_milliseconds::text AS "lengthInMilliseconds",
        NULLIF(d.hls, '') AS "hlsUrl",
        NULLIF(d.dash, '') AS "dashUrl",
        NULLIF(d.share, '') AS "shareUrl",
        selected_download.url AS "downloadUrl",
        selected_download.quality AS "downloadQuality",
        selected_download.width AS "downloadWidth",
        selected_download.height AS "downloadHeight",
        CASE
          WHEN selected_download.url IS NOT NULL THEN 'DOWNLOAD'
          WHEN NULLIF(d.hls, '') IS NOT NULL THEN 'HLS'
          WHEN NULLIF(d.dash, '') IS NOT NULL THEN 'DASH'
          ELSE 'NONE'
        END AS "mediaSourceType",
        COALESCE(
          selected_download.url,
          NULLIF(d.hls, ''),
          NULLIF(d.dash, '')
        ) AS "mediaSourceUrl",
        COALESCE(published_state.video_published, FALSE) AS "videoPublished",
        d.published AS "dubPublished",
        v.no_index AS "videoNoIndex",
        (v.deleted_at IS NOT NULL) AS "videoDeleted",
        (d.deleted_at IS NOT NULL) AS "dubDeleted",
        COALESCE(d.deleted_at, v.deleted_at)::text AS "deletedAt",
        (
          d.deleted_at IS NULL
          AND v.deleted_at IS NULL
          AND (edition.id IS NULL OR edition.deleted_at IS NULL)
          AND language.id IS NOT NULL
          AND language.deleted_at IS NULL
          AND d.published = TRUE
          AND v.no_index = FALSE
          AND COALESCE(published_state.video_published, FALSE) = TRUE
          AND (
            selected_download.url IS NOT NULL
            OR NULLIF(d.hls, '') IS NOT NULL
            OR NULLIF(d.dash, '') IS NOT NULL
          )
        ) AS "indexable",
        CASE
          WHEN d.deleted_at IS NOT NULL THEN 'dub_deleted'
          WHEN v.deleted_at IS NOT NULL THEN 'video_deleted'
          WHEN v.no_index = TRUE THEN 'video_no_index'
          WHEN COALESCE(published_state.video_published, FALSE) = FALSE
            THEN 'video_unpublished'
          WHEN d.published = FALSE THEN 'dub_unpublished'
          WHEN language.id IS NULL THEN 'language_missing'
          WHEN language.deleted_at IS NOT NULL THEN 'language_deleted'
          WHEN edition.id IS NOT NULL AND edition.deleted_at IS NOT NULL
            THEN 'edition_deleted'
          WHEN selected_download.url IS NULL
            AND NULLIF(d.hls, '') IS NULL
            AND NULLIF(d.dash, '') IS NULL
            THEN 'media_missing'
          ELSE NULL
        END AS "nonIndexableReason"
      FROM paged_dubs d
      JOIN video v
        ON v.id = d.video_id
      LEFT JOIN language
        ON language.id = d.language_id
      LEFT JOIN video_edition edition
        ON edition.id = d.video_edition_id
      LEFT JOIN published_state_by_video published_state
        ON published_state.video_id = v.id
      LEFT JOIN selected_title_by_video selected_title
        ON selected_title.video_id = v.id
      LEFT JOIN LATERAL (
        SELECT
          download.url,
          download.quality,
          download.width,
          download.height
        FROM video_dub_download download
        WHERE download.video_dub_id = d.id
          AND d.downloadable = TRUE
          AND download.deleted_at IS NULL
          AND NULLIF(download.url, '') IS NOT NULL
          AND download.url ~* '^https?://'
        ORDER BY
          download.width DESC NULLS LAST,
          download.height DESC NULLS LAST,
          download.updated_at DESC
        LIMIT 1
      ) selected_download ON TRUE
      ORDER BY d.id ASC
    `
      },
      { timeout: VIDEO_MAPPER_CATALOG_TRANSACTION_TIMEOUT_MS },
    )

    const nodes = rows.slice(0, pageSize)
    return {
      nodes,
      pageInfo: {
        startCursor:
          nodes.length === 0
            ? null
            : encodeMapperCatalogCursor(nodes[0].adminDubId),
        endCursor:
          nodes.length === 0
            ? null
            : encodeMapperCatalogCursor(nodes[nodes.length - 1].adminDubId),
        hasNextPage: rows.length > pageSize,
      },
    }
  }

  private async assertMapperCatalogCursorExists(adminDubId: string | null) {
    if (adminDubId == null) return

    const row = await this.prisma.videoDub.findUnique({
      where: { id: adminDubId },
      select: { id: true },
    })
    if (row == null) {
      throw new VideoLookupValidationError("Invalid videoMapperCatalog cursor")
    }
  }

  async getWatchHomeVideos({
    coreIds,
    query,
  }: {
    coreIds: readonly string[]
    query: object
  }) {
    if (coreIds.length === 0) return []
    if (coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
      throw new VideoLookupValidationError(
        `coreIds.length=${coreIds.length} exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      )
    }

    const uniqueCoreIds = [...new Set(coreIds)]
    const rows = await this.prisma.video.findMany({
      ...withVideoCoreIdForOrdering(query),
      where: {
        coreId: { in: uniqueCoreIds },
        deletedAt: null,
      },
    })
    const rowByCoreId = new Map(rows.map((row) => [row.coreId, row]))

    return coreIds.flatMap((coreId) => {
      const row = rowByCoreId.get(coreId)
      return row == null ? [] : [row]
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
    targetLocale,
  }: {
    coreIds: readonly string[]
    targetLocale?: string | null
  }): Promise<VideoForEnrichment[]> {
    if (coreIds.length === 0) return []
    if (coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
      throw new VideoLookupValidationError(
        `coreIds.length=${coreIds.length} exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      )
    }
    const requestedTargetLocale = normalizeOptionalLocale(targetLocale)

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
              ${requestedTargetLocale}::text AS "targetLocale",
              primary_language.bcp47 AS "primaryLanguageBcp47",
              CASE
                WHEN ${requestedTargetLocale}::text IS NULL
                  THEN primary_language.bcp47
                ELSE requested_language.bcp47
              END AS "languageBcp47",
              selected_mux.asset_id AS "muxAssetId",
              selected_subtitle.vtt_src AS "subtitleUrl"
            FROM video v
            LEFT JOIN language primary_language
              ON primary_language.id = v.primary_language_id
              AND primary_language.deleted_at IS NULL
            LEFT JOIN language requested_language
              ON ${requestedTargetLocale}::text IS NOT NULL
              AND LOWER(requested_language.bcp47) =
                LOWER(${requestedTargetLocale}::text)
              AND requested_language.deleted_at IS NULL
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
                AND LOWER(dub_language.bcp47) = LOWER(
                  CASE
                    WHEN ${requestedTargetLocale}::text IS NULL
                      THEN primary_language.bcp47
                    ELSE requested_language.bcp47
                  END
                )
                AND mux_video.asset_id IS NOT NULL
                AND mux_video.asset_id <> ''
              ORDER BY dub.published DESC NULLS LAST, dub.updated_at DESC
              LIMIT 1
            ) selected_mux ON TRUE
            LEFT JOIN LATERAL (
              SELECT subtitle.vtt_src
              FROM video_subtitle subtitle
              JOIN language subtitle_language
                ON subtitle_language.id = subtitle.language_id
                AND subtitle_language.deleted_at IS NULL
              WHERE subtitle.video_id = v.id
                AND subtitle.deleted_at IS NULL
                AND LOWER(subtitle_language.bcp47) = LOWER(
                  CASE
                    WHEN ${requestedTargetLocale}::text IS NULL
                      THEN primary_language.bcp47
                    ELSE requested_language.bcp47
                  END
                )
                AND subtitle.vtt_src IS NOT NULL
                AND subtitle.vtt_src <> ''
              ORDER BY
                (CASE WHEN subtitle.primary THEN 0 ELSE 1 END) +
                (CASE WHEN subtitle.ai_generated THEN 1 ELSE 0 END) ASC,
                subtitle.updated_at DESC
              LIMIT 1
            ) selected_subtitle ON TRUE
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
        targetLocale: video.targetLocale,
        primaryLanguageBcp47: video.primaryLanguageBcp47,
        languageBcp47: video.languageBcp47,
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
      : {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
        }

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

function normalizeMapperCatalogPageSize(first: number | null | undefined) {
  const value = first ?? VIDEO_MAPPER_CATALOG_DEFAULT_PAGE_SIZE
  if (!Number.isInteger(value) || value <= 0) {
    throw new VideoLookupValidationError(
      "videoMapperCatalog.first must be a positive integer",
    )
  }
  return Math.min(value, VIDEO_MAPPER_CATALOG_MAX_PAGE_SIZE)
}

function encodeMapperCatalogCursor(adminDubId: string) {
  return Buffer.from(
    `${VIDEO_MAPPER_CATALOG_CURSOR_PREFIX}${adminDubId}`,
    "utf8",
  ).toString("base64url")
}

function decodeMapperCatalogCursor(cursor: string | null | undefined) {
  const normalized = cursor?.trim()
  if (!normalized) return null

  let decoded: string
  try {
    decoded = Buffer.from(normalized, "base64url").toString("utf8")
  } catch {
    throw new VideoLookupValidationError("Invalid videoMapperCatalog cursor")
  }

  if (!decoded.startsWith(VIDEO_MAPPER_CATALOG_CURSOR_PREFIX)) {
    throw new VideoLookupValidationError("Invalid videoMapperCatalog cursor")
  }

  const adminDubId = decoded.slice(VIDEO_MAPPER_CATALOG_CURSOR_PREFIX.length)
  if (adminDubId.length === 0) {
    throw new VideoLookupValidationError("Invalid videoMapperCatalog cursor")
  }
  return adminDubId
}

function withVideoCoreIdForOrdering(query: object): object {
  const prismaQuery = query as { select?: Record<string, unknown> }
  if (!prismaQuery.select) return query
  return {
    ...prismaQuery,
    select: {
      ...prismaQuery.select,
      coreId: true,
    },
  }
}

function normalizeOptionalLocale(locale: string | null | undefined) {
  const normalized = locale?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

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
