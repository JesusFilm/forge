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
  type Video as PrismaVideo,
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

export type WatchHomeCarouselPoolSource = {
  coreId: string
  source: PrismaVideo | null
  playableCount: number
  videos: PrismaVideo[]
}

/**
 * Maximum coreIds accepted in a single `getByCoreIds` call. Mirrors
 * the receiver-side cap in manager's `admin-trigger-route.ts` so the
 * contract is double-locked.
 */
export const VIDEOS_BY_CORE_IDS_MAX = 100
export const WATCH_HOME_CAROUSEL_POOL_LIMIT_DEFAULT = 12
export const WATCH_HOME_CAROUSEL_POOL_LIMIT_MAX = 20
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

  async getWatchHomeCarouselPools({
    coreIds,
    user,
    languageSlug,
    limit = WATCH_HOME_CAROUSEL_POOL_LIMIT_DEFAULT,
  }: {
    coreIds: readonly string[]
    user: Principal | null
    languageSlug?: string | null
    limit?: number | null
  }): Promise<WatchHomeCarouselPoolSource[]> {
    if (coreIds.length === 0) return []
    if (coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
      throw new VideoLookupValidationError(
        `coreIds.length=${coreIds.length} exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      )
    }

    const take = clampWatchHomeCarouselPoolLimit(limit)
    const requestedLanguageSlug = normalizeOptionalLocale(languageSlug)
    const uniqueCoreIds = [...new Set(coreIds)]
    const sources = await this.prisma.video.findMany({
      where: {
        coreId: { in: uniqueCoreIds },
        deletedAt: null,
      },
    })
    const sourceByCoreId = new Map(
      sources.map((source) => [source.coreId, source]),
    )

    const rows: WatchHomeCarouselPoolSource[] = []
    for (const coreId of coreIds) {
      const source = sourceByCoreId.get(coreId) ?? null
      if (!source) {
        rows.push({ coreId, source: null, playableCount: 0, videos: [] })
        continue
      }

      const childWhere = watchHomeCarouselPlayableVideoWhere({ user })
      const playableCount = await this.prisma.videoRelation.count({
        where: {
          parentId: source.id,
          child: childWhere,
        },
      })

      if (playableCount > 0) {
        const videos = await this.getWatchHomeCarouselChildVideos({
          sourceId: source.id,
          user,
          languageSlug: requestedLanguageSlug,
          take,
        })
        rows.push({ coreId, source, playableCount, videos })
        continue
      }

      const sourcePlayableCount = await this.prisma.video.count({
        where: {
          id: source.id,
          ...watchHomeCarouselPlayableVideoWhere({ user }),
        },
      })

      rows.push({
        coreId,
        source,
        playableCount: sourcePlayableCount,
        videos: sourcePlayableCount > 0 ? [source] : [],
      })
    }

    return rows
  }

  private async getWatchHomeCarouselChildVideos({
    sourceId,
    user,
    languageSlug,
    take,
  }: {
    sourceId: string
    user: Principal | null
    languageSlug: string | null
    take: number
  }): Promise<PrismaVideo[]> {
    const selected: PrismaVideo[] = []
    const selectedIds: string[] = []

    if (languageSlug != null) {
      const exactRelations = await this.findWatchHomeCarouselChildRelations({
        sourceId,
        where: watchHomeCarouselPlayableVideoWhere({ user, languageSlug }),
        take,
      })
      for (const relation of exactRelations) {
        if (!relation.child) continue
        selected.push(relation.child)
        selectedIds.push(relation.child.id)
      }
    }

    if (selected.length < take) {
      const fallbackWhere = watchHomeCarouselPlayableVideoWhere({ user })
      const fallbackRelations = await this.findWatchHomeCarouselChildRelations({
        sourceId,
        where:
          selectedIds.length > 0
            ? {
                ...fallbackWhere,
                id: { notIn: selectedIds },
              }
            : fallbackWhere,
        take: take - selected.length,
      })
      for (const relation of fallbackRelations) {
        if (!relation.child) continue
        selected.push(relation.child)
      }
    }

    return selected
  }

  private async findWatchHomeCarouselChildRelations({
    sourceId,
    where,
    take,
  }: {
    sourceId: string
    where: Prisma.VideoWhereInput
    take: number
  }) {
    return this.prisma.videoRelation.findMany({
      where: {
        parentId: sourceId,
        child: where,
      },
      orderBy: [{ order: "asc" }, { childId: "asc" }],
      take,
      include: { child: true },
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

function clampWatchHomeCarouselPoolLimit(
  value: number | null | undefined,
): number {
  if (value == null || !Number.isFinite(value)) {
    return WATCH_HOME_CAROUSEL_POOL_LIMIT_DEFAULT
  }
  return Math.max(
    1,
    Math.min(Math.trunc(value), WATCH_HOME_CAROUSEL_POOL_LIMIT_MAX),
  )
}

function watchHomeCarouselPlayableDubWhere(
  languageSlug?: string | null,
): Prisma.VideoDubWhereInput {
  return {
    deletedAt: null,
    published: true,
    hls: { not: null },
    language: {
      deletedAt: null,
      slug: languageSlug != null ? languageSlug : { not: null },
    },
  }
}

function watchHomeCarouselPlayableVideoWhere({
  user,
  languageSlug,
}: {
  user: Principal | null
  languageSlug?: string | null
}): Prisma.VideoWhereInput {
  return {
    deletedAt: null,
    dubs: { some: watchHomeCarouselPlayableDubWhere(languageSlug) },
    ...(isEditorOrAdmin(user)
      ? {}
      : {
          locales: {
            some: {
              status: "PUBLISHED",
              deletedAt: null,
            },
          },
        }),
  }
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
