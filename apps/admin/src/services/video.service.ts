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
  type VideoDub,
  type VideoLabel,
  type VideoSource,
} from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import {
  getOrScheduleWatchChapterCarouselMuxBlurDataUrl,
  getOrScheduleWatchChapterCarouselMuxDominantColor,
  getOrScheduleWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchHeroPosterMuxDominantColor,
} from "@/services/mux-image-derivative.service"
import { publicMediaAssetPreviewUrl } from "@/services/media-asset.service"
import {
  notRestrictedFromWatchWhere,
  watchVisibilityWhere,
} from "./search-watchability"
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

export type WatchLanguageInventoryAvailability = "AUDIO" | "SUBTITLE_ONLY"

export type WatchLanguageInventoryLanguage = {
  slug: string
  name: Prisma.JsonValue | null
  bcp47: string | null
}

export type WatchLanguageInventoryItem = {
  id: string
  coreId: string
  slug: string
  title: string
  description: string | null
  imageUrl: string | null
  imageAlt: string | null
  label: string | null
  availability: WatchLanguageInventoryAvailability
  watchLanguageSlug: string
  parentSlug: string | null
  parentTitle: string | null
  parentOrder?: number | null
  durationSeconds: number | null
  childCount: number
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type WatchLanguageInventoryCounts = {
  audioCollections: number
  audioVideos: number
  subtitleOnlyVideos: number
  total: number
}

export type WatchLanguageInventory = {
  language: WatchLanguageInventoryLanguage | null
  counts: WatchLanguageInventoryCounts
  promoted: WatchLanguageInventoryItem[]
  audioCollections: WatchLanguageInventoryItem[]
  audioVideos: WatchLanguageInventoryItem[]
  subtitleOnlyVideos: WatchLanguageInventoryItem[]
}

export type WatchRouteSnapshotImage = {
  documentId: string
  url: string | null
  thumbnail: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  dominantColor: string | null
}

export type WatchRouteSnapshotLanguage = {
  coreId: string | null
  bcp47: string | null
  slug?: string | null
  name?: Prisma.JsonValue | null
}

export type WatchRouteSnapshotLocale = {
  documentId: string
  languageSlug: string | null
  publishedAt: string | null
  title: string | null
  description: string | null
  snippet: string | null
  imageAlt: string | null
  searchTitle?: string | null
  searchDescription?: string | null
  socialImage?: WatchRouteSnapshotSocialImage | null
}

export type WatchRouteSnapshotSocialImage = {
  url: string
  width: number | null
  height: number | null
  mimeType: string | null
}

export type WatchRouteSnapshotRootLocale = WatchRouteSnapshotLocale & {
  searchTitle: string | null
  searchDescription: string | null
  socialImage: WatchRouteSnapshotSocialImage | null
}

export type WatchRouteSnapshotChild = {
  documentId: string
  slug: string | null
  label: VideoLabel | null
  images: WatchRouteSnapshotImage[]
  exactLocales: WatchRouteSnapshotLocale[]
  broadLocales: WatchRouteSnapshotLocale[]
  englishLocales: WatchRouteSnapshotLocale[]
  durationSeconds: number | null
  muxPlaybackId: string | null
  muxThumbnailBlurDataUrl: string | null
  muxThumbnailDominantColor: string | null
  muxHeroPosterBlurDataUrl: string | null
  muxHeroPosterDominantColor: string | null
}

export type WatchRouteSnapshotChildRelation = {
  order: number | null
  child: WatchRouteSnapshotChild | null
}

export type WatchRouteSnapshotParent = {
  documentId: string
  slug: string | null
  noIndex: boolean | null
  label: VideoLabel | null
  images: WatchRouteSnapshotImage[]
  exactLocales: WatchRouteSnapshotLocale[]
  broadLocales: WatchRouteSnapshotLocale[]
  englishLocales: WatchRouteSnapshotLocale[]
  children: WatchRouteSnapshotChildRelation[]
}

export type WatchRouteSnapshotParentRelation = {
  parent: WatchRouteSnapshotParent | null
}

export type WatchRouteSnapshotBibleBook = {
  documentId: string
  name: Prisma.JsonValue | null
}

export type WatchRouteSnapshotBibleCitation = {
  documentId: string
  chapterStart: number | null
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
  order: number | null
  osisId: string | null
  bibleBook: WatchRouteSnapshotBibleBook | null
}

export type WatchRouteSnapshotStudyQuestion = {
  documentId: string
  languageSlug: string | null
  value: string | null
  order: number | null
}

export type WatchRouteSnapshotPreferredVariant = {
  documentId: string
  slug: string | null
  published: boolean | null
  hls: string | null
  duration: number | null
  language: WatchRouteSnapshotLanguage | null
  muxHeroPosterBlurDataUrl: string | null
  muxHeroPosterDominantColor: string | null
}

export type WatchRouteSnapshot = {
  documentId: string
  slug: string | null
  publishedAt: string | null
  noIndex: boolean | null
  label: VideoLabel | null
  images: WatchRouteSnapshotImage[]
  primaryLanguage: WatchRouteSnapshotLanguage | null
  parents: WatchRouteSnapshotParentRelation[]
  children: WatchRouteSnapshotChildRelation[]
  bibleCitations: WatchRouteSnapshotBibleCitation[]
  exactLocales: WatchRouteSnapshotRootLocale[]
  broadLocales: WatchRouteSnapshotRootLocale[]
  englishLocales: WatchRouteSnapshotRootLocale[]
  exactStudyQuestions: WatchRouteSnapshotStudyQuestion[]
  broadStudyQuestions: WatchRouteSnapshotStudyQuestion[]
  englishStudyQuestions: WatchRouteSnapshotStudyQuestion[]
  playableDubLanguageCount: number
  preferredVariant: WatchRouteSnapshotPreferredVariant | null
}

type WatchRouteSnapshotMuxRow = {
  videoId: string
  muxVideoId: string | null
  playbackId: string | null
}

type WatchRouteSnapshotDurationRow = {
  videoId: string
  duration: number | null
}

type WatchRouteSnapshotPreferredVariantRow = {
  id: string
  slug: string | null
  published: boolean | null
  hls: string | null
  duration: number | null
  languageCoreId: string | null
  languageBcp47: string | null
  languageSlug: string | null
  languageName: Prisma.JsonValue | null
  muxVideoId: string | null
  playbackId: string | null
}

type WatchRouteSnapshotCountRow = {
  count: number
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
export const WATCH_LANGUAGE_INVENTORY_MAX_ITEMS_PER_BUCKET = 1_000
const WATCH_LANGUAGE_INVENTORY_DEFAULT_ITEMS_PER_BUCKET =
  WATCH_LANGUAGE_INVENTORY_MAX_ITEMS_PER_BUCKET
const WATCH_LANGUAGE_INVENTORY_PROMOTED_COUNT = 12
const WATCH_LANGUAGE_INVENTORY_STATEMENT_TIMEOUT_MS = 10_000
const WATCH_LANGUAGE_INVENTORY_TRANSACTION_TIMEOUT_MS = 11_000
const WATCH_LANGUAGE_INVENTORY_STATEMENT_TIMEOUT_SQL = `SET LOCAL statement_timeout = '${WATCH_LANGUAGE_INVENTORY_STATEMENT_TIMEOUT_MS}ms'`

const VIDEO_RELATION_ORDER_BY = [
  { order: { sort: "asc" as const, nulls: "last" as const } },
  { createdAt: "asc" as const },
  { id: "asc" as const },
] satisfies Prisma.VideoRelationOrderByWithRelationInput[]

const PLAYABLE_DUB_WHERE = {
  deletedAt: null,
  published: true,
  AND: [{ hls: { not: null } }, { hls: { not: "" } }],
  video: { deletedAt: null },
} satisfies Prisma.VideoDubWhereInput

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
  | "episodes"
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
  // Set by the public `videos` GraphQL resolver only — the dashboard's
  // `live-data.ts` caller intentionally omits it (U2: list's own auth
  // gate is the requireSession()'d route, and editors need to keep
  // seeing watch-restricted videos in the library).
  excludeWatchRestricted?: boolean
}

const VIDEO_CATEGORY_LABELS = {
  collections: ["COLLECTION"],
  episodes: ["EPISODE"],
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
              { blurDataUrl: text },
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

function localeBucketsForSnapshot(
  rows: Array<{
    id: string
    videoId: string
    languageSlug: string | null
    publishedAt: Date | null
    locale: string | null
    title: string | null
    description: string | null
    snippet: string | null
    imageAlt: string | null
  }>,
  videoId: string,
  {
    locale,
    languageSlug,
  }: {
    locale: string
    languageSlug: string | null
  },
) {
  const forVideo = rows.filter((row) => row.videoId === videoId)
  const mapRow = (row: (typeof rows)[number]): WatchRouteSnapshotLocale => ({
    documentId: row.id,
    languageSlug: row.languageSlug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    title: row.title,
    description: row.description,
    snippet: row.snippet,
    imageAlt: row.imageAlt,
  })

  return {
    exactLocales: forVideo
      .filter(
        (row) =>
          row.locale === locale &&
          (languageSlug == null || row.languageSlug === languageSlug),
      )
      .map(mapRow),
    broadLocales: forVideo.filter((row) => row.locale === locale).map(mapRow),
    englishLocales: forVideo.filter((row) => row.locale === "en").map(mapRow),
  }
}

const watchRouteSnapshotRootLocaleSelect = {
  id: true,
  videoId: true,
  locale: true,
  languageSlug: true,
  publishedAt: true,
  title: true,
  description: true,
  snippet: true,
  imageAlt: true,
  searchTitle: true,
  searchDescription: true,
  socialImageAssetId: true,
} satisfies Prisma.VideoLocaleSelect

type WatchRouteSnapshotRootLocaleRow = Prisma.VideoLocaleGetPayload<{
  select: typeof watchRouteSnapshotRootLocaleSelect
}>

/**
 * Loads editor-owned search/social fields for the root video only. Related
 * parent and child locale rows stay on the lean title/copy projection above.
 * Referenced assets are deduplicated and hydrated in at most one public-safe
 * batch, keeping snapshot query count independent of locale count.
 */
export async function loadWatchRouteSnapshotRootLocaleBuckets({
  prisma,
  videoId,
  locale,
  languageSlug,
  includeUnpublished,
  publicMediaBaseUrl,
}: {
  prisma: Pick<PrismaClient, "videoLocale" | "mediaAsset">
  videoId: string
  locale: string
  languageSlug: string | null
  includeUnpublished: boolean
  publicMediaBaseUrl?: string
}): Promise<{
  exactLocales: WatchRouteSnapshotRootLocale[]
  broadLocales: WatchRouteSnapshotRootLocale[]
  englishLocales: WatchRouteSnapshotRootLocale[]
}> {
  const rows = await prisma.videoLocale.findMany({
    where: {
      videoId,
      deletedAt: null,
      ...(includeUnpublished ? {} : { status: "PUBLISHED" as const }),
      OR: [
        { locale },
        { locale: "en" },
        ...(languageSlug == null ? [] : [{ locale, languageSlug }]),
      ],
    },
    orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
    select: watchRouteSnapshotRootLocaleSelect,
  })

  const bucketRows = {
    exactLocales: rows.filter(
      (row) =>
        row.locale === locale &&
        (languageSlug == null || row.languageSlug === languageSlug),
    ),
    broadLocales: rows.filter((row) => row.locale === locale),
    englishLocales: rows.filter((row) => row.locale === "en"),
  }
  const selectedRows = [
    ...bucketRows.exactLocales,
    ...bucketRows.broadLocales,
    ...bucketRows.englishLocales,
  ]
  const socialImageAssetIds = Array.from(
    new Set(
      selectedRows.flatMap((row) =>
        row.socialImageAssetId ? [row.socialImageAssetId] : [],
      ),
    ),
  )
  const assets =
    socialImageAssetIds.length === 0
      ? []
      : await prisma.mediaAsset.findMany({
          where: {
            id: { in: socialImageAssetIds },
            kind: "IMAGE",
            status: "READY",
            visibility: "PUBLIC",
          },
          select: {
            id: true,
            backend: true,
            status: true,
            visibility: true,
            objectKey: true,
            previewObjectKey: true,
            muxPlaybackId: true,
            mimeType: true,
            width: true,
            height: true,
          },
        })
  const socialImageByAssetId = new Map<string, WatchRouteSnapshotSocialImage>()
  for (const asset of assets) {
    const url = publicMediaAssetPreviewUrl(asset, publicMediaBaseUrl)
    if (!url) continue
    socialImageByAssetId.set(asset.id, {
      url,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    })
  }

  const mapRow = (
    row: WatchRouteSnapshotRootLocaleRow,
  ): WatchRouteSnapshotRootLocale => ({
    documentId: row.id,
    languageSlug: row.languageSlug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    title: row.title,
    description: row.description,
    snippet: row.snippet,
    imageAlt: row.imageAlt,
    searchTitle: row.searchTitle,
    searchDescription: row.searchDescription,
    socialImage: row.socialImageAssetId
      ? (socialImageByAssetId.get(row.socialImageAssetId) ?? null)
      : null,
  })

  return {
    exactLocales: bucketRows.exactLocales.map(mapRow),
    broadLocales: bucketRows.broadLocales.map(mapRow),
    englishLocales: bucketRows.englishLocales.map(mapRow),
  }
}

function studyQuestionBucketsForSnapshot(
  rows: Array<{
    id: string
    languageSlug: string | null
    locale: string | null
    text: string
    order: number | null
  }>,
  {
    locale,
    languageSlug,
  }: {
    locale: string
    languageSlug: string | null
  },
) {
  const mapRow = (
    row: (typeof rows)[number],
  ): WatchRouteSnapshotStudyQuestion => ({
    documentId: row.id,
    languageSlug: row.languageSlug,
    value: row.text,
    order: row.order,
  })

  return {
    exactStudyQuestions: rows
      .filter(
        (row) =>
          row.locale === locale &&
          (languageSlug == null || row.languageSlug === languageSlug),
      )
      .map(mapRow),
    broadStudyQuestions: rows
      .filter((row) => row.locale === locale)
      .map(mapRow),
    englishStudyQuestions: rows
      .filter((row) => row.locale === "en")
      .map(mapRow),
  }
}

function imageRowsForSnapshot(
  rows: Array<{
    id: string
    videoId: string
    url: string | null
    thumbnail: string | null
    mobileCinematicHigh: string | null
    mobileCinematicLow: string | null
    dominantColor: string | null
  }>,
  videoId: string,
): WatchRouteSnapshotImage[] {
  return rows
    .filter((row) => row.videoId === videoId)
    .map((row) => ({
      documentId: row.id,
      url: row.url,
      thumbnail: row.thumbnail,
      mobileCinematicHigh: row.mobileCinematicHigh,
      mobileCinematicLow: row.mobileCinematicLow,
      dominantColor: row.dominantColor,
    }))
}

function firstByVideoId<T extends { videoId: string }>(rows: T[]) {
  const byVideoId = new Map<string, T>()
  for (const row of rows) {
    if (!byVideoId.has(row.videoId)) byVideoId.set(row.videoId, row)
  }
  return byVideoId
}

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  private async findPreferredPlayableMuxRows(
    videoIds: string[],
  ): Promise<WatchRouteSnapshotMuxRow[]> {
    if (videoIds.length === 0) return []

    return this.prisma.$queryRaw<WatchRouteSnapshotMuxRow[]>`
      SELECT
        v.id AS "videoId",
        COALESCE(primary_dub.mux_video_id, fallback_dub.mux_video_id) AS "muxVideoId",
        COALESCE(primary_dub.playback_id, fallback_dub.playback_id) AS "playbackId"
      FROM "video" v
      LEFT JOIN LATERAL (
        SELECT mv.id AS mux_video_id, mv.playback_id
        FROM "video_dub" vd
        JOIN "mux_video" mv
          ON mv.id = vd.mux_video_id
         AND mv.playback_id IS NOT NULL
         AND mv.deleted_at IS NULL
        WHERE vd.video_id = v.id
          AND v.primary_language_id IS NOT NULL
          AND vd.language_id = v.primary_language_id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) primary_dub ON true
      LEFT JOIN LATERAL (
        SELECT mv.id AS mux_video_id, mv.playback_id
        FROM "video_dub" vd
        JOIN "mux_video" mv
          ON mv.id = vd.mux_video_id
         AND mv.playback_id IS NOT NULL
         AND mv.deleted_at IS NULL
        WHERE vd.video_id = v.id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) fallback_dub ON primary_dub.playback_id IS NULL
      WHERE v.id IN (${Prisma.join(videoIds)})
        AND v.deleted_at IS NULL
    `
  }

  private async findExactLanguagePlayableMuxRows({
    videoIds,
    languageSlug,
  }: {
    videoIds: string[]
    languageSlug: string | null
  }): Promise<WatchRouteSnapshotMuxRow[]> {
    if (videoIds.length === 0 || languageSlug == null) return []

    return this.prisma.$queryRaw<WatchRouteSnapshotMuxRow[]>`
      SELECT
        v.id AS "videoId",
        exact_dub.mux_video_id AS "muxVideoId",
        exact_dub.playback_id AS "playbackId"
      FROM "video" v
      LEFT JOIN LATERAL (
        SELECT mv.id AS mux_video_id, mv.playback_id
        FROM "video_dub" vd
        JOIN "language" l
          ON l.id = vd.language_id
         AND l.slug = ${languageSlug}
         AND l.deleted_at IS NULL
        JOIN "mux_video" mv
          ON mv.id = vd.mux_video_id
         AND mv.playback_id IS NOT NULL
         AND mv.deleted_at IS NULL
        WHERE vd.video_id = v.id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) exact_dub ON true
      WHERE v.id IN (${Prisma.join(videoIds)})
        AND v.deleted_at IS NULL
    `
  }

  private async findPreferredPlayableDurationRows(
    videoIds: string[],
  ): Promise<WatchRouteSnapshotDurationRow[]> {
    if (videoIds.length === 0) return []

    return this.prisma.$queryRaw<WatchRouteSnapshotDurationRow[]>`
      SELECT
        v.id AS "videoId",
        COALESCE(primary_dub.duration, fallback_dub.duration) AS "duration"
      FROM "video" v
      LEFT JOIN LATERAL (
        SELECT vd.duration
        FROM "video_dub" vd
        WHERE vd.video_id = v.id
          AND v.primary_language_id IS NOT NULL
          AND vd.language_id = v.primary_language_id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
          AND vd.duration > 0
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) primary_dub ON true
      LEFT JOIN LATERAL (
        SELECT vd.duration
        FROM "video_dub" vd
        WHERE vd.video_id = v.id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
          AND vd.duration > 0
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) fallback_dub ON true
      WHERE v.id IN (${Prisma.join(videoIds)})
        AND v.deleted_at IS NULL
    `
  }

  private async findPreferredPlayableVariantRow(
    videoId: string,
  ): Promise<WatchRouteSnapshotPreferredVariantRow | null> {
    const rows = await this.prisma.$queryRaw<
      WatchRouteSnapshotPreferredVariantRow[]
    >`
      SELECT
        COALESCE(primary_dub.id, fallback_dub.id) AS "id",
        COALESCE(primary_dub.slug, fallback_dub.slug) AS "slug",
        COALESCE(primary_dub.published, fallback_dub.published) AS "published",
        COALESCE(primary_dub.hls, fallback_dub.hls) AS "hls",
        COALESCE(primary_dub.duration, fallback_dub.duration) AS "duration",
        COALESCE(primary_dub.language_core_id, fallback_dub.language_core_id) AS "languageCoreId",
        COALESCE(primary_dub.language_bcp47, fallback_dub.language_bcp47) AS "languageBcp47",
        COALESCE(primary_dub.language_slug, fallback_dub.language_slug) AS "languageSlug",
        COALESCE(primary_dub.language_name, fallback_dub.language_name) AS "languageName",
        COALESCE(primary_dub.mux_video_id, fallback_dub.mux_video_id) AS "muxVideoId",
        COALESCE(primary_dub.playback_id, fallback_dub.playback_id) AS "playbackId"
      FROM "video" v
      LEFT JOIN LATERAL (
        SELECT
          vd.id,
          vd.slug,
          vd.published,
          vd.hls,
          vd.duration,
          mv.id AS mux_video_id,
          mv.playback_id,
          l.core_id AS language_core_id,
          l.bcp47 AS language_bcp47,
          l.slug AS language_slug,
          l.name AS language_name
        FROM "video_dub" vd
        LEFT JOIN "mux_video" mv
          ON mv.id = vd.mux_video_id
         AND mv.deleted_at IS NULL
         AND mv.playback_id IS NOT NULL
        LEFT JOIN "language" l
          ON l.id = vd.language_id
         AND l.deleted_at IS NULL
        WHERE vd.video_id = v.id
          AND v.primary_language_id IS NOT NULL
          AND vd.language_id = v.primary_language_id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) primary_dub ON true
      LEFT JOIN LATERAL (
        SELECT
          vd.id,
          vd.slug,
          vd.published,
          vd.hls,
          vd.duration,
          mv.id AS mux_video_id,
          mv.playback_id,
          l.core_id AS language_core_id,
          l.bcp47 AS language_bcp47,
          l.slug AS language_slug,
          l.name AS language_name
        FROM "video_dub" vd
        LEFT JOIN "mux_video" mv
          ON mv.id = vd.mux_video_id
         AND mv.deleted_at IS NULL
         AND mv.playback_id IS NOT NULL
        LEFT JOIN "language" l
          ON l.id = vd.language_id
         AND l.deleted_at IS NULL
        WHERE vd.video_id = v.id
          AND vd.deleted_at IS NULL
          AND vd.published = true
          AND vd.hls IS NOT NULL
          AND vd.hls <> ''
        ORDER BY vd.duration DESC, vd.id ASC
        LIMIT 1
      ) fallback_dub ON primary_dub.id IS NULL
      WHERE v.id = ${videoId}
        AND v.deleted_at IS NULL
      LIMIT 1
    `

    return rows[0]?.id == null ? null : rows[0]
  }

  private async countPlayableDubLanguagesForSnapshot(
    videoId: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<WatchRouteSnapshotCountRow[]>`
      SELECT COUNT(DISTINCT vd.language_id)::int AS "count"
      FROM "video_dub" vd
      JOIN "language" l
        ON l.id = vd.language_id
       AND l.slug IS NOT NULL
       AND l.deleted_at IS NULL
      WHERE vd.video_id = ${videoId}
        AND vd.language_id IS NOT NULL
        AND vd.deleted_at IS NULL
        AND vd.published = true
        AND vd.hls IS NOT NULL
        AND vd.hls <> ''
    `

    return rows[0]?.count ?? 0
  }

  async list({ input: raw, query }: { input: VideoListInput; query: object }) {
    const filters = [videoListWhere(raw)]
    if (raw.excludeWatchRestricted) filters.push(notRestrictedFromWatchWhere())

    return this.prisma.video.findMany({
      ...query,
      where: filters.length === 1 ? filters[0] : { AND: filters },
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
      where: { id, deletedAt: null, ...notRestrictedFromWatchWhere() },
    })
  }

  async getBySlug({ slug, query }: { slug: string; query: object }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { slug, deletedAt: null, ...notRestrictedFromWatchWhere() },
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
      where: {
        id,
        deletedAt: null,
        video: { deletedAt: null, ...notRestrictedFromWatchWhere() },
      },
    })
  }

  async getPreferredPlayableDub({
    videoId,
    languageSlug,
    query,
  }: {
    videoId: string
    languageSlug?: string | null
    query: object
  }): Promise<VideoDub | null> {
    const baseWhere = {
      ...PLAYABLE_DUB_WHERE,
      videoId,
    } satisfies Prisma.VideoDubWhereInput

    const normalizedLanguageSlug =
      typeof languageSlug === "string" && languageSlug.length > 0
        ? languageSlug
        : null

    if (normalizedLanguageSlug) {
      const exact = await this.prisma.videoDub.findFirst({
        ...query,
        where: {
          ...baseWhere,
          language: {
            deletedAt: null,
            OR: [
              { slug: normalizedLanguageSlug },
              { bcp47: normalizedLanguageSlug },
            ],
          },
        },
        orderBy: [{ duration: "desc" }, { id: "asc" }],
      })
      if (exact) return exact
    }

    const video = await this.prisma.video.findFirst({
      where: { id: videoId, deletedAt: null },
      select: { primaryLanguageId: true },
    })
    if (video?.primaryLanguageId) {
      const primary = await this.prisma.videoDub.findFirst({
        ...query,
        where: {
          ...baseWhere,
          languageId: video.primaryLanguageId,
        },
        orderBy: [{ duration: "desc" }, { id: "asc" }],
      })
      if (primary) return primary
    }

    return this.prisma.videoDub.findFirst({
      ...query,
      where: baseWhere,
      orderBy: [{ duration: "desc" }, { id: "asc" }],
    })
  }

  async countPlayableDubLanguages({
    videoId,
  }: {
    videoId: string
  }): Promise<number> {
    const rows = await this.prisma.videoDub.findMany({
      where: {
        ...PLAYABLE_DUB_WHERE,
        videoId,
        languageId: { not: null },
        language: { slug: { not: null }, deletedAt: null },
      },
      distinct: ["languageId"],
      select: { languageId: true },
    })

    return rows.length
  }

  async getWatchRouteSnapshotBySlug({
    slug,
    locale,
    languageSlug,
    user,
  }: {
    slug: string
    locale: string
    languageSlug?: string | null
    user: Principal | null
  }): Promise<WatchRouteSnapshot | null> {
    const normalizedLanguageSlug =
      typeof languageSlug === "string" && languageSlug.length > 0
        ? languageSlug
        : null
    const visibleVideo: Prisma.VideoWhereInput = isEditorOrAdmin(user)
      ? { deletedAt: null }
      : {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          ...notRestrictedFromWatchWhere(),
        }

    const root = await this.prisma.video.findFirst({
      where: { slug, deletedAt: null, ...watchVisibilityWhere(user) },
      select: {
        id: true,
        slug: true,
        publishedAt: true,
        noIndex: true,
        label: true,
        primaryLanguageId: true,
        primaryLanguage: { select: { coreId: true, bcp47: true } },
      },
    })
    if (!root) return null

    const [parentRelations, childRelations, citations] = await Promise.all([
      this.prisma.videoRelation.findMany({
        where: { childId: root.id, parent: visibleVideo },
        orderBy: VIDEO_RELATION_ORDER_BY,
        select: {
          id: true,
          parentId: true,
          parent: {
            select: {
              id: true,
              slug: true,
              noIndex: true,
              label: true,
              primaryLanguageId: true,
            },
          },
        },
      }),
      this.prisma.videoRelation.findMany({
        where: { parentId: root.id, child: visibleVideo },
        orderBy: VIDEO_RELATION_ORDER_BY,
        select: {
          id: true,
          order: true,
          childId: true,
          child: {
            select: {
              id: true,
              slug: true,
              label: true,
              primaryLanguageId: true,
            },
          },
        },
      }),
      this.prisma.bibleCitation.findMany({
        where: { videoId: root.id, deletedAt: null },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          chapterStart: true,
          chapterEnd: true,
          verseStart: true,
          verseEnd: true,
          order: true,
          osisId: true,
          bibleBook: { select: { id: true, name: true } },
        },
      }),
    ])

    const parentIds = parentRelations.map((relation) => relation.parentId)
    const rootChildIds = childRelations.map((relation) => relation.childId)
    const parentChildRelations =
      parentIds.length === 0
        ? []
        : await this.prisma.videoRelation.findMany({
            where: { parentId: { in: parentIds }, child: visibleVideo },
            orderBy: VIDEO_RELATION_ORDER_BY,
            select: {
              id: true,
              order: true,
              parentId: true,
              childId: true,
              child: {
                select: {
                  id: true,
                  slug: true,
                  label: true,
                  primaryLanguageId: true,
                },
              },
            },
          })

    const relatedVideoIds = [
      ...parentIds,
      ...rootChildIds,
      ...parentChildRelations.map((relation) => relation.childId),
    ]
    const allVideoIds = Array.from(new Set([root.id, ...relatedVideoIds]))
    const localeArgs = { locale, languageSlug: normalizedLanguageSlug }

    const [
      imageRows,
      localeRows,
      rootLocaleBuckets,
      studyQuestionRows,
      exactMuxRows,
      fallbackMuxRows,
      durationRows,
      playableDubLanguageCount,
      preferredExact,
      preferredFallback,
    ] = await Promise.all([
      this.prisma.videoImage.findMany({
        where: { videoId: { in: allVideoIds }, deletedAt: null },
        select: {
          id: true,
          videoId: true,
          url: true,
          thumbnail: true,
          mobileCinematicHigh: true,
          mobileCinematicLow: true,
          dominantColor: true,
        },
      }),
      this.prisma.videoLocale.findMany({
        where: {
          videoId: { in: relatedVideoIds },
          deletedAt: null,
          ...(isEditorOrAdmin(user) ? {} : { status: "PUBLISHED" as const }),
          OR: [
            { locale },
            { locale: "en" },
            ...(normalizedLanguageSlug == null
              ? []
              : [{ locale, languageSlug: normalizedLanguageSlug }]),
          ],
        },
        orderBy: [{ languageSlug: "asc" }, { id: "asc" }],
        select: {
          id: true,
          videoId: true,
          locale: true,
          languageSlug: true,
          publishedAt: true,
          title: true,
          description: true,
          snippet: true,
          imageAlt: true,
        },
      }),
      loadWatchRouteSnapshotRootLocaleBuckets({
        prisma: this.prisma,
        videoId: root.id,
        ...localeArgs,
        includeUnpublished: isEditorOrAdmin(user),
      }),
      this.prisma.videoStudyQuestion.findMany({
        where: {
          videoId: root.id,
          deletedAt: null,
          OR: [
            { locale },
            { locale: "en" },
            ...(normalizedLanguageSlug == null
              ? []
              : [{ locale, languageSlug: normalizedLanguageSlug }]),
          ],
        },
        orderBy: [{ order: "asc" }, { languageSlug: "asc" }, { id: "asc" }],
        select: {
          id: true,
          locale: true,
          languageSlug: true,
          text: true,
          order: true,
        },
      }),
      this.findExactLanguagePlayableMuxRows({
        videoIds: relatedVideoIds,
        languageSlug: normalizedLanguageSlug,
      }),
      this.findPreferredPlayableMuxRows(relatedVideoIds),
      this.findPreferredPlayableDurationRows([root.id, ...rootChildIds]),
      this.countPlayableDubLanguagesForSnapshot(root.id),
      normalizedLanguageSlug == null
        ? null
        : this.prisma.videoDub.findFirst({
            where: {
              ...PLAYABLE_DUB_WHERE,
              videoId: root.id,
              language: {
                deletedAt: null,
                OR: [
                  { slug: normalizedLanguageSlug },
                  { bcp47: normalizedLanguageSlug },
                ],
              },
            },
            orderBy: [{ duration: "desc" }, { id: "asc" }],
            select: {
              id: true,
              slug: true,
              published: true,
              hls: true,
              duration: true,
              muxVideoId: true,
              muxVideo: {
                select: {
                  id: true,
                  playbackId: true,
                  deletedAt: true,
                },
              },
              language: {
                select: {
                  coreId: true,
                  bcp47: true,
                  slug: true,
                  name: true,
                },
              },
            },
          }),
      this.findPreferredPlayableVariantRow(root.id),
    ])

    const exactMuxByVideoId = firstByVideoId(
      exactMuxRows.filter((row) => row.playbackId != null),
    )
    const fallbackMuxByVideoId = new Map<
      string,
      WatchRouteSnapshotMuxRow | null
    >()
    for (const row of fallbackMuxRows) {
      fallbackMuxByVideoId.set(row.videoId, row)
    }
    const durationByVideoId = new Map<string, number | null>()
    for (const row of durationRows) {
      durationByVideoId.set(row.videoId, row.duration)
    }
    const muxByVideoId = new Map<string, WatchRouteSnapshotMuxRow>()
    for (const videoId of relatedVideoIds) {
      const muxRow =
        exactMuxByVideoId.get(videoId) ??
        fallbackMuxByVideoId.get(videoId) ??
        null
      if (muxRow?.muxVideoId && muxRow.playbackId) {
        muxByVideoId.set(videoId, muxRow)
      }
    }
    const blurDataUrlByVideoId = new Map<string, string | null>()
    const dominantColorByVideoId = new Map<string, string | null>()
    const heroBlurDataUrlByVideoId = new Map<string, string | null>()
    const heroDominantColorByVideoId = new Map<string, string | null>()
    await Promise.all(
      Array.from(muxByVideoId.entries()).map(([videoId, muxRow]) =>
        (async () => {
          if (!muxRow.muxVideoId || !muxRow.playbackId) return
          const [
            blurDataUrl,
            dominantColor,
            heroBlurDataUrl,
            heroDominantColor,
          ] = await Promise.all([
            getOrScheduleWatchChapterCarouselMuxBlurDataUrl({
              prisma: this.prisma,
              muxVideoId: muxRow.muxVideoId,
              playbackId: muxRow.playbackId,
            }),
            getOrScheduleWatchChapterCarouselMuxDominantColor({
              prisma: this.prisma,
              muxVideoId: muxRow.muxVideoId,
              playbackId: muxRow.playbackId,
            }),
            getOrScheduleWatchHeroPosterMuxBlurDataUrl({
              prisma: this.prisma,
              muxVideoId: muxRow.muxVideoId,
              playbackId: muxRow.playbackId,
            }),
            getOrScheduleWatchHeroPosterMuxDominantColor({
              prisma: this.prisma,
              muxVideoId: muxRow.muxVideoId,
              playbackId: muxRow.playbackId,
            }),
          ])
          blurDataUrlByVideoId.set(videoId, blurDataUrl)
          dominantColorByVideoId.set(videoId, dominantColor)
          heroBlurDataUrlByVideoId.set(videoId, heroBlurDataUrl)
          heroDominantColorByVideoId.set(videoId, heroDominantColor)
        })(),
      ),
    )

    const makeChild = (
      child: {
        id: string
        slug: string | null
        label: VideoLabel | null
      } | null,
      includeDuration: boolean,
    ): WatchRouteSnapshotChild | null => {
      if (!child) return null
      const muxRow = muxByVideoId.get(child.id) ?? null
      const playbackId = muxRow?.playbackId ?? null
      return {
        documentId: child.id,
        slug: child.slug,
        label: child.label,
        images: imageRowsForSnapshot(imageRows, child.id),
        ...localeBucketsForSnapshot(localeRows, child.id, localeArgs),
        durationSeconds: includeDuration
          ? (durationByVideoId.get(child.id) ?? null)
          : null,
        muxPlaybackId: playbackId,
        muxThumbnailBlurDataUrl: blurDataUrlByVideoId.get(child.id) ?? null,
        muxThumbnailDominantColor: dominantColorByVideoId.get(child.id) ?? null,
        muxHeroPosterBlurDataUrl:
          heroBlurDataUrlByVideoId.get(child.id) ?? null,
        muxHeroPosterDominantColor:
          heroDominantColorByVideoId.get(child.id) ?? null,
      }
    }

    const parentChildrenByParentId = new Map<
      string,
      WatchRouteSnapshotChildRelation[]
    >()
    for (const relation of parentChildRelations) {
      const child = makeChild(relation.child, false)
      const children = parentChildrenByParentId.get(relation.parentId) ?? []
      children.push({ order: relation.order, child })
      parentChildrenByParentId.set(relation.parentId, children)
    }

    const preferredVariant = preferredExact ?? preferredFallback
    const preferredVariantLanguage =
      preferredVariant == null
        ? null
        : "language" in preferredVariant
          ? preferredVariant.language
            ? {
                coreId: preferredVariant.language.coreId,
                bcp47: preferredVariant.language.bcp47,
                slug: preferredVariant.language.slug,
                name: preferredVariant.language.name,
              }
            : null
          : preferredVariant.languageCoreId == null &&
              preferredVariant.languageBcp47 == null &&
              preferredVariant.languageSlug == null &&
              preferredVariant.languageName == null
            ? null
            : {
                coreId: preferredVariant.languageCoreId,
                bcp47: preferredVariant.languageBcp47,
                slug: preferredVariant.languageSlug,
                name: preferredVariant.languageName,
              }

    const preferredVariantMux =
      preferredVariant == null
        ? null
        : "playbackId" in preferredVariant
          ? {
              muxVideoId: preferredVariant.muxVideoId,
              playbackId: preferredVariant.playbackId,
            }
          : preferredVariant.muxVideo?.deletedAt == null
            ? {
                muxVideoId: preferredVariant.muxVideoId,
                playbackId: preferredVariant.muxVideo?.playbackId ?? null,
              }
            : null

    const preferredVariantHeroBlurDataUrl =
      preferredVariantMux?.muxVideoId && preferredVariantMux.playbackId
        ? await getOrScheduleWatchHeroPosterMuxBlurDataUrl({
            prisma: this.prisma,
            muxVideoId: preferredVariantMux.muxVideoId,
            playbackId: preferredVariantMux.playbackId,
          })
        : null
    const preferredVariantHeroDominantColor =
      preferredVariantMux?.muxVideoId && preferredVariantMux.playbackId
        ? await getOrScheduleWatchHeroPosterMuxDominantColor({
            prisma: this.prisma,
            muxVideoId: preferredVariantMux.muxVideoId,
            playbackId: preferredVariantMux.playbackId,
          })
        : null

    return {
      documentId: root.id,
      slug: root.slug,
      publishedAt: root.publishedAt?.toISOString() ?? null,
      noIndex: root.noIndex,
      label: root.label,
      images: imageRowsForSnapshot(imageRows, root.id),
      primaryLanguage: root.primaryLanguage
        ? {
            coreId: root.primaryLanguage.coreId,
            bcp47: root.primaryLanguage.bcp47,
          }
        : null,
      parents: parentRelations.map((relation) => ({
        parent: relation.parent
          ? {
              documentId: relation.parent.id,
              slug: relation.parent.slug,
              noIndex: relation.parent.noIndex,
              label: relation.parent.label,
              images: imageRowsForSnapshot(imageRows, relation.parent.id),
              ...localeBucketsForSnapshot(
                localeRows,
                relation.parent.id,
                localeArgs,
              ),
              children: parentChildrenByParentId.get(relation.parent.id) ?? [],
            }
          : null,
      })),
      children: childRelations.map((relation) => ({
        order: relation.order,
        child: makeChild(relation.child, true),
      })),
      bibleCitations: citations.map((citation) => ({
        documentId: citation.id,
        chapterStart: citation.chapterStart,
        chapterEnd: citation.chapterEnd,
        verseStart: citation.verseStart,
        verseEnd: citation.verseEnd,
        order: citation.order,
        osisId: citation.osisId,
        bibleBook: citation.bibleBook
          ? {
              documentId: citation.bibleBook.id,
              name: citation.bibleBook.name,
            }
          : null,
      })),
      ...rootLocaleBuckets,
      ...studyQuestionBucketsForSnapshot(studyQuestionRows, localeArgs),
      playableDubLanguageCount,
      preferredVariant: preferredVariant
        ? {
            documentId: preferredVariant.id,
            slug: preferredVariant.slug,
            published: preferredVariant.published,
            hls: preferredVariant.hls,
            duration: preferredVariant.duration,
            language: preferredVariantLanguage,
            muxHeroPosterBlurDataUrl: preferredVariantHeroBlurDataUrl,
            muxHeroPosterDominantColor: preferredVariantHeroDominantColor,
          }
        : null,
    }
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
        ...notRestrictedFromWatchWhere(),
      },
    })
    const rowByCoreId = new Map(rows.map((row) => [row.coreId, row]))

    return coreIds.flatMap((coreId) => {
      const row = rowByCoreId.get(coreId)
      return row == null ? [] : [row]
    })
  }

  async getWatchLanguageInventory({
    languageSlug,
    limit,
  }: {
    languageSlug: string
    limit?: number | null
  }): Promise<WatchLanguageInventory> {
    const normalizedSlug = normalizeSearchValue(languageSlug)
    if (!normalizedSlug) return emptyWatchLanguageInventory(null)

    const languageRow = await this.prisma.language.findFirst({
      where: { slug: normalizedSlug, deletedAt: null },
      select: { slug: true, name: true, bcp47: true },
    })
    if (languageRow?.slug == null) return emptyWatchLanguageInventory(null)
    const language: WatchLanguageInventoryLanguage = {
      slug: languageRow.slug,
      name: languageRow.name,
      bcp47: languageRow.bcp47,
    }

    const pageSize = normalizeWatchLanguageInventoryLimit(limit)
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          WATCH_LANGUAGE_INVENTORY_STATEMENT_TIMEOUT_SQL,
        )
        return tx.$queryRaw<WatchLanguageInventoryRow[]>`
      WITH inventory_language AS (
        SELECT id, slug, bcp47
        FROM language
        WHERE slug = ${language.slug}
          AND deleted_at IS NULL
        LIMIT 1
      ),
      playable_audio AS MATERIALIZED (
        SELECT DISTINCT ON (dub.video_id)
          dub.video_id AS "videoId",
          dub.duration AS "durationSeconds"
        FROM video_dub dub
        JOIN inventory_language
          ON inventory_language.id = dub.language_id
        LEFT JOIN video_edition edition
          ON edition.id = dub.video_edition_id
        WHERE dub.deleted_at IS NULL
          AND dub.published = TRUE
          AND dub.hls IS NOT NULL
          AND dub.hls <> ''
          AND (edition.id IS NULL OR edition.deleted_at IS NULL)
        ORDER BY
          dub.video_id ASC,
          dub.duration DESC NULLS LAST,
          dub.updated_at DESC,
          dub.id ASC
      ),
      usable_subtitle AS MATERIALIZED (
        SELECT DISTINCT
          subtitle.video_id AS "directVideoId",
          subtitle.video_edition_id AS "videoEditionId"
        FROM video_subtitle subtitle
        JOIN inventory_language
          ON inventory_language.id = subtitle.language_id
        JOIN video_edition subtitle_edition
          ON subtitle_edition.id = subtitle.video_edition_id
         AND subtitle_edition.deleted_at IS NULL
        WHERE subtitle.deleted_at IS NULL
          AND (
            (subtitle.vtt_src IS NOT NULL AND subtitle.vtt_src <> '')
            OR (subtitle.srt_src IS NOT NULL AND subtitle.srt_src <> '')
          )
      ),
      usable_subtitle_video AS MATERIALIZED (
        SELECT "directVideoId" AS "videoId"
        FROM usable_subtitle
        WHERE "directVideoId" IS NOT NULL
        UNION
        SELECT edition_dub.video_id AS "videoId"
        FROM usable_subtitle subtitle
        JOIN video_dub edition_dub
          ON edition_dub.video_edition_id = subtitle."videoEditionId"
      ),
      candidate_video_source AS (
        SELECT
          "videoId",
          TRUE AS "hasAudio",
          FALSE AS "hasSubtitle"
        FROM playable_audio
        UNION ALL
        SELECT
          "videoId",
          FALSE AS "hasAudio",
          TRUE AS "hasSubtitle"
        FROM usable_subtitle_video
      ),
      candidate_video_id AS MATERIALIZED (
        SELECT
          "videoId",
          BOOL_OR("hasAudio") AS "hasAudio",
          BOOL_OR("hasSubtitle") AS "hasSubtitle"
        FROM candidate_video_source
        GROUP BY "videoId"
      ),
      eligible_candidate_video AS MATERIALIZED (
        SELECT
          video.id,
          video.core_id AS "coreId",
          video.slug,
          video.label::text AS label,
          video.primary_language_id AS "primaryLanguageId",
          candidate."hasAudio",
          candidate."hasSubtitle",
          video.published_at AS "publishedAt",
          video.created_at AS "createdAt",
          video.updated_at AS "updatedAt"
        FROM candidate_video_id candidate
        JOIN video
          ON video.id = candidate."videoId"
        WHERE video.deleted_at IS NULL
          AND video.no_index = FALSE
          AND NOT ('watch' = ANY(video.restrict_view_platforms))
          AND EXISTS (
            SELECT 1
            FROM video_locale published_locale
            WHERE published_locale.video_id = video.id
              AND published_locale.deleted_at IS NULL
              AND published_locale.status = 'published'
          )
      ),
      audio_collection_candidate AS (
        SELECT
          'audio_collection' AS bucket,
          parent.id,
          parent.core_id AS "coreId",
          parent.slug,
          parent.label::text AS label,
          parent.primary_language_id AS "primaryLanguageId",
          NULL::integer AS "durationSeconds",
          parent.published_at AS "publishedAt",
          parent.created_at AS "createdAt",
          parent.updated_at AS "updatedAt",
          GREATEST(
            COALESCE(parent.published_at, parent.created_at),
            COALESCE(parent.updated_at, parent.created_at),
            parent.created_at,
            MAX(
              GREATEST(
                COALESCE(child."publishedAt", child."createdAt"),
                COALESCE(child."updatedAt", child."createdAt"),
                child."createdAt"
              )
            )
          ) AS "sortAt"
        FROM eligible_candidate_video child
        JOIN video_relation relation
          ON relation.child_id = child.id
        JOIN video parent
          ON parent.id = relation.parent_id
        WHERE child."hasAudio" = TRUE
          AND parent.deleted_at IS NULL
          AND parent.no_index = FALSE
          AND NOT ('watch' = ANY(parent.restrict_view_platforms))
          AND EXISTS (
            SELECT 1
            FROM video_locale published_locale
            WHERE published_locale.video_id = parent.id
              AND published_locale.deleted_at IS NULL
              AND published_locale.status = 'published'
          )
        GROUP BY
          parent.id,
          parent.core_id,
          parent.slug,
          parent.label,
          parent.primary_language_id,
          parent.published_at,
          parent.created_at,
          parent.updated_at
      ),
      audio_video_candidate AS (
        SELECT
          'audio_video' AS bucket,
          video.id,
          video."coreId",
          video.slug,
          video.label,
          video."primaryLanguageId",
          audio."durationSeconds",
          video."publishedAt",
          video."createdAt",
          video."updatedAt",
          GREATEST(
            COALESCE(video."publishedAt", video."createdAt"),
            COALESCE(video."updatedAt", video."createdAt"),
            video."createdAt"
          ) AS "sortAt"
        FROM eligible_candidate_video video
        JOIN playable_audio audio
          ON audio."videoId" = video.id
        WHERE NOT EXISTS (
          SELECT 1
          FROM video_relation child_relation
          WHERE child_relation.parent_id = video.id
        )
      ),
      subtitle_video_candidate AS (
        SELECT
          'subtitle_video' AS bucket,
          video.id,
          video."coreId",
          video.slug,
          video.label,
          video."primaryLanguageId",
          NULL::integer AS "durationSeconds",
          video."publishedAt",
          video."createdAt",
          video."updatedAt",
          GREATEST(
            COALESCE(video."publishedAt", video."createdAt"),
            COALESCE(video."updatedAt", video."createdAt"),
            video."createdAt"
          ) AS "sortAt"
        FROM eligible_candidate_video video
        WHERE video."hasSubtitle" = TRUE
          AND video."hasAudio" = FALSE
          AND NOT EXISTS (
            SELECT 1
            FROM video_relation child_relation
            WHERE child_relation.parent_id = video.id
          )
          AND EXISTS (
            SELECT 1
            FROM video_dub fallback_dub
            JOIN language fallback_language
              ON fallback_language.id = fallback_dub.language_id
             AND fallback_language.deleted_at IS NULL
             AND fallback_language.slug IS NOT NULL
            LEFT JOIN video_edition fallback_edition
              ON fallback_edition.id = fallback_dub.video_edition_id
            WHERE fallback_dub.video_id = video.id
              AND fallback_dub.deleted_at IS NULL
              AND fallback_dub.published = TRUE
              AND fallback_dub.hls IS NOT NULL
              AND fallback_dub.hls <> ''
              AND (
                fallback_edition.id IS NULL
                OR fallback_edition.deleted_at IS NULL
              )
          )
      ),
      candidate_inventory AS (
        SELECT * FROM audio_collection_candidate
        UNION ALL
        SELECT * FROM audio_video_candidate
        UNION ALL
        SELECT * FROM subtitle_video_candidate
      ),
      candidate_recency AS (
        SELECT
          candidate_inventory.*,
          COUNT(*) OVER (PARTITION BY bucket) AS "bucketTotal",
          ROW_NUMBER() OVER (
            PARTITION BY bucket
            ORDER BY "sortAt" DESC NULLS LAST
          ) AS recency_rank
        FROM candidate_inventory
      ),
      candidate_cutoff AS (
        SELECT bucket, "sortAt"
        FROM candidate_recency
        WHERE recency_rank = ${pageSize}
      ),
      prelimited_candidates AS (
        SELECT candidate_recency.*
        FROM candidate_recency
        LEFT JOIN candidate_cutoff
          ON candidate_cutoff.bucket = candidate_recency.bucket
        WHERE candidate_recency.recency_rank <= ${pageSize}
          OR candidate_recency."sortAt" IS NOT DISTINCT FROM candidate_cutoff."sortAt"
      ),
      title_video_id AS MATERIALIZED (
        SELECT candidate.id
        FROM prelimited_candidates candidate
      ),
      title_locale AS MATERIALIZED (
        SELECT DISTINCT ON (locale.video_id)
          locale.video_id AS "videoId",
          NULLIF(BTRIM(locale.title), '') AS title
        FROM title_video_id title_video
        JOIN video_locale locale
          ON locale.video_id = title_video.id
        JOIN inventory_language
          ON TRUE
        WHERE locale.deleted_at IS NULL
          AND locale.status = 'published'
          AND NULLIF(BTRIM(locale.title), '') IS NOT NULL
          AND (
            locale.language_id = inventory_language.id
            OR locale.language_slug = inventory_language.slug
            OR locale.locale = inventory_language.bcp47
            OR locale.language_slug = 'english'
            OR locale.locale = 'en'
          )
        ORDER BY
          locale.video_id ASC,
          CASE
            WHEN locale.language_id = inventory_language.id THEN 0
            WHEN locale.language_slug = inventory_language.slug THEN 1
            WHEN locale.locale = inventory_language.bcp47 THEN 2
            WHEN locale.language_slug = 'english' THEN 3
            WHEN locale.locale = 'en' THEN 4
            ELSE 5
          END ASC,
          locale.updated_at DESC,
          locale.id ASC
      ),
      candidate_display AS (
        SELECT
          candidate.*,
          COALESCE(
            candidate_title_locale.title,
            NULLIF(
              INITCAP(
                REGEXP_REPLACE(BTRIM(candidate.slug), '[-_]+', ' ', 'g')
              ),
              ''
            ),
            candidate."coreId",
            candidate.id
          ) AS title,
          COALESCE(
            NULLIF(candidate_locale.description, ''),
            NULLIF(candidate_locale.snippet, '')
          ) AS description,
          candidate_locale.image_alt AS "imageAlt"
        FROM prelimited_candidates candidate
        JOIN inventory_language
          ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            locale.description,
            locale.snippet,
            locale.image_alt
          FROM video_locale locale
          WHERE locale.video_id = candidate.id
            AND locale.deleted_at IS NULL
            AND locale.status = 'published'
          ORDER BY
            CASE
              WHEN locale.language_id = inventory_language.id THEN 0
              WHEN locale.language_slug = inventory_language.slug THEN 1
              WHEN locale.locale = inventory_language.bcp47 THEN 2
              WHEN locale.language_slug = 'english' THEN 3
              WHEN locale.locale = 'en' THEN 4
              ELSE 5
            END ASC,
            locale.updated_at DESC,
            locale.id ASC
          LIMIT 1
        ) candidate_locale ON TRUE
        LEFT JOIN title_locale candidate_title_locale
          ON candidate_title_locale."videoId" = candidate.id
      ),
      ranked_candidates AS (
        SELECT
          candidate_display.*,
          ROW_NUMBER() OVER (
            PARTITION BY bucket
            ORDER BY
              "sortAt" DESC NULLS LAST,
              title ASC,
              id ASC
          ) AS bucket_rank
        FROM candidate_display
      ),
      limited_candidates AS (
        SELECT *
        FROM ranked_candidates
        WHERE bucket_rank <= ${pageSize}
      )
      SELECT
        candidate.bucket,
        candidate.id,
        candidate."coreId",
        candidate.slug,
        candidate.title,
        candidate.description,
        selected_image.image_url AS "imageUrl",
        candidate."imageAlt",
        candidate.label,
        CASE
          WHEN candidate.bucket = 'subtitle_video' THEN 'SUBTITLE_ONLY'
          ELSE 'AUDIO'
        END AS availability,
        CASE
          WHEN candidate.bucket = 'subtitle_video' THEN fallback_dub.language_slug
          ELSE inventory_language.slug
        END AS "watchLanguageSlug",
        parent_ref.slug AS "parentSlug",
        parent_ref.title AS "parentTitle",
        parent_ref."parentOrder",
        CASE
          WHEN candidate.bucket = 'subtitle_video' THEN fallback_dub.duration
          ELSE candidate."durationSeconds"
        END AS "durationSeconds",
        CASE
          WHEN candidate.bucket = 'audio_collection' THEN COALESCE(child_counts.count, 0)
          ELSE 0
        END AS "childCount",
        candidate."publishedAt"::text AS "publishedAt",
        candidate."createdAt"::text AS "createdAt",
        candidate."updatedAt"::text AS "updatedAt",
        candidate."sortAt",
        candidate."bucketTotal"
      FROM limited_candidates candidate
      JOIN inventory_language
        ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          NULLIF(image.mobile_cinematic_high, ''),
          NULLIF(image.video_still, ''),
          NULLIF(image.thumbnail, ''),
          NULLIF(image.url, '')
        ) AS image_url
        FROM video_image image
        WHERE image.video_id = candidate.id
          AND image.deleted_at IS NULL
          AND COALESCE(
            NULLIF(image.mobile_cinematic_high, ''),
            NULLIF(image.video_still, ''),
            NULLIF(image.thumbnail, ''),
            NULLIF(image.url, '')
          ) IS NOT NULL
        ORDER BY
          CASE
            WHEN NULLIF(image.mobile_cinematic_high, '') IS NOT NULL THEN 0
            WHEN NULLIF(image.video_still, '') IS NOT NULL THEN 1
            WHEN NULLIF(image.thumbnail, '') IS NOT NULL THEN 2
            ELSE 3
          END ASC,
          image.updated_at DESC,
          image.id ASC
        LIMIT 1
      ) selected_image ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS count
        FROM video_relation child_relation
        JOIN video child_video
          ON child_video.id = child_relation.child_id
        WHERE candidate.bucket = 'audio_collection'
          AND child_relation.parent_id = candidate.id
          AND child_video.deleted_at IS NULL
          AND child_video.no_index = FALSE
          AND NOT ('watch' = ANY(child_video.restrict_view_platforms))
          AND EXISTS (
            SELECT 1
            FROM video_locale published_locale
            WHERE published_locale.video_id = child_video.id
              AND published_locale.deleted_at IS NULL
              AND published_locale.status = 'published'
          )
      ) child_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          parent.slug,
          relation.order AS "parentOrder",
          COALESCE(
            parent_title_locale.title,
            NULLIF(
              INITCAP(
                REGEXP_REPLACE(BTRIM(parent.slug), '[-_]+', ' ', 'g')
              ),
              ''
            ),
            parent.core_id,
            parent.id
          ) AS title
        FROM video_relation relation
        JOIN video parent
          ON parent.id = relation.parent_id
        LEFT JOIN LATERAL (
          SELECT NULLIF(BTRIM(locale.title), '') AS title
          FROM video_locale locale
          WHERE locale.video_id = parent.id
            AND locale.deleted_at IS NULL
            AND locale.status = 'published'
            AND NULLIF(BTRIM(locale.title), '') IS NOT NULL
            AND (
              locale.language_id = inventory_language.id
              OR locale.language_slug = inventory_language.slug
              OR locale.locale = inventory_language.bcp47
              OR locale.language_slug = 'english'
              OR locale.locale = 'en'
            )
          ORDER BY
            CASE
              WHEN locale.language_id = inventory_language.id THEN 0
              WHEN locale.language_slug = inventory_language.slug THEN 1
              WHEN locale.locale = inventory_language.bcp47 THEN 2
              WHEN locale.language_slug = 'english' THEN 3
              WHEN locale.locale = 'en' THEN 4
              ELSE 5
            END ASC,
            locale.updated_at DESC,
            locale.id ASC
          LIMIT 1
        ) parent_title_locale ON TRUE
        WHERE candidate.bucket <> 'audio_collection'
          AND relation.child_id = candidate.id
          AND parent.deleted_at IS NULL
          AND parent.no_index = FALSE
          AND NOT ('watch' = ANY(parent.restrict_view_platforms))
          AND EXISTS (
            SELECT 1
            FROM video_locale published_locale
            WHERE published_locale.video_id = parent.id
              AND published_locale.deleted_at IS NULL
              AND published_locale.status = 'published'
          )
        ORDER BY relation.order ASC NULLS LAST, relation.created_at ASC
        LIMIT 1
      ) parent_ref ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          fallback_language.slug AS language_slug,
          fallback_audio.duration
        FROM video_dub fallback_audio
        JOIN language fallback_language
          ON fallback_language.id = fallback_audio.language_id
         AND fallback_language.deleted_at IS NULL
         AND fallback_language.slug IS NOT NULL
        LEFT JOIN video_edition fallback_edition
          ON fallback_edition.id = fallback_audio.video_edition_id
        WHERE candidate.bucket = 'subtitle_video'
          AND fallback_audio.video_id = candidate.id
          AND fallback_audio.deleted_at IS NULL
          AND fallback_audio.published = TRUE
          AND fallback_audio.hls IS NOT NULL
          AND fallback_audio.hls <> ''
          AND (
            fallback_edition.id IS NULL
            OR fallback_edition.deleted_at IS NULL
          )
        ORDER BY
          CASE
            WHEN candidate."primaryLanguageId" = fallback_language.id THEN 0
            WHEN fallback_language.slug = 'english' THEN 1
            ELSE 2
          END ASC,
          fallback_audio.duration DESC NULLS LAST,
          fallback_language.slug ASC,
          fallback_audio.id ASC
        LIMIT 1
      ) fallback_dub ON TRUE
      ORDER BY
        CASE
          WHEN candidate.bucket = 'audio_collection' THEN 0
          WHEN candidate.bucket = 'audio_video' THEN 1
          ELSE 2
        END ASC,
        candidate."sortAt" DESC NULLS LAST,
        candidate.title ASC,
        candidate.id ASC
    `
      },
      { timeout: WATCH_LANGUAGE_INVENTORY_TRANSACTION_TIMEOUT_MS },
    )

    const audioCollections = bucketItems(rows, "audio_collection")
    const audioVideos = bucketItems(rows, "audio_video")
    const subtitleOnlyVideos = bucketItems(rows, "subtitle_video")
    const counts = {
      audioCollections: bucketTotal(rows, "audio_collection"),
      audioVideos: bucketTotal(rows, "audio_video"),
      subtitleOnlyVideos: bucketTotal(rows, "subtitle_video"),
      total: 0,
    }
    counts.total =
      counts.audioCollections + counts.audioVideos + counts.subtitleOnlyVideos

    const promoted = rows
      .slice()
      .sort(
        (a, b) =>
          rowRecencyScore(b) - rowRecencyScore(a) ||
          a.title.localeCompare(b.title),
      )
      .slice(0, WATCH_LANGUAGE_INVENTORY_PROMOTED_COUNT)
      .map(toWatchLanguageInventoryItem)

    return {
      language,
      counts,
      promoted,
      audioCollections,
      audioVideos,
      subtitleOnlyVideos,
    }
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
          ...notRestrictedFromWatchWhere(),
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

  /**
   * One downloadable Dub per visible direct child in the requested language.
   * The child filter mirrors getChildDubLanguages, but this intent-time query
   * is bounded by child video id instead of language id so collection download
   * callers receive at most one Dub (plus its selected GraphQL fields) per
   * displayed episode.
   */
  async getDownloadableChildDubs({
    videoId,
    languageSlug,
    user,
    query,
  }: {
    videoId: string
    languageSlug: string
    user: Principal | null
    query: object
  }): Promise<VideoDub[]> {
    const childVisibility: Prisma.VideoWhereInput = isEditorOrAdmin(user)
      ? { deletedAt: null }
      : {
          deletedAt: null,
          locales: { some: { status: "PUBLISHED", deletedAt: null } },
          ...notRestrictedFromWatchWhere(),
        }

    return this.prisma.videoDub.findMany({
      ...query,
      where: {
        deletedAt: null,
        published: true,
        downloadable: true,
        language: { slug: languageSlug, deletedAt: null },
        downloads: {
          some: {
            deletedAt: null,
            quality: { not: null },
            url: { not: null },
          },
        },
        video: {
          ...childVisibility,
          parents: { some: { parentId: videoId } },
        },
      },
      distinct: ["videoId"],
      orderBy: [{ videoId: "asc" }, { duration: "desc" }, { id: "asc" }],
    })
  }
}

type WatchLanguageInventoryBucket =
  | "audio_collection"
  | "audio_video"
  | "subtitle_video"

type WatchLanguageInventoryRow = WatchLanguageInventoryItem & {
  bucket: WatchLanguageInventoryBucket
  bucketTotal: number | bigint
  sortAt: Date | string | null
}

function normalizeWatchLanguageInventoryLimit(
  limit: number | null | undefined,
) {
  const parsed = Number.isFinite(limit ?? NaN)
    ? Math.floor(Number(limit))
    : WATCH_LANGUAGE_INVENTORY_DEFAULT_ITEMS_PER_BUCKET
  if (parsed <= 0) return 1
  return Math.min(parsed, WATCH_LANGUAGE_INVENTORY_MAX_ITEMS_PER_BUCKET)
}

function emptyWatchLanguageInventory(
  language: WatchLanguageInventoryLanguage | null,
): WatchLanguageInventory {
  return {
    language,
    counts: {
      audioCollections: 0,
      audioVideos: 0,
      subtitleOnlyVideos: 0,
      total: 0,
    },
    promoted: [],
    audioCollections: [],
    audioVideos: [],
    subtitleOnlyVideos: [],
  }
}

function bucketItems(
  rows: WatchLanguageInventoryRow[],
  bucket: WatchLanguageInventoryBucket,
): WatchLanguageInventoryItem[] {
  return rows
    .filter((row) => row.bucket === bucket)
    .map(toWatchLanguageInventoryItem)
}

function bucketTotal(
  rows: WatchLanguageInventoryRow[],
  bucket: WatchLanguageInventoryBucket,
): number {
  const total = rows.find((row) => row.bucket === bucket)?.bucketTotal
  if (typeof total === "bigint") return Number(total)
  return total ?? 0
}

function toWatchLanguageInventoryItem({
  bucket: _bucket,
  bucketTotal: _bucketTotal,
  sortAt: _sortAt,
  ...item
}: WatchLanguageInventoryRow): WatchLanguageInventoryItem {
  return item
}

function timestampScore(value: Date | string | null | undefined): number {
  if (!value) return 0
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function recencyScore(item: WatchLanguageInventoryItem): number {
  return Math.max(
    timestampScore(item.publishedAt),
    timestampScore(item.updatedAt),
    timestampScore(item.createdAt),
  )
}

function rowRecencyScore(row: WatchLanguageInventoryRow): number {
  return timestampScore(row.sortAt) || recencyScore(row)
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
