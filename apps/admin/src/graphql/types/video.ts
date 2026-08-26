// Pothos types for Video and its relations (public-shape, Core-sourced,
// read-only at the GraphQL layer). `lengthInMilliseconds` is BigInt →
// exposed as String to avoid JS Number precision loss. Per Unit 4 of
// docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import type { Prisma } from "@prisma/client"
import { GraphQLError } from "graphql"

import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"
import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"
import {
  getOrScheduleWatchHeroPosterMuxBlurDataUrl,
  getOrScheduleWatchHeroPosterMuxDominantColor,
} from "@/services/mux-image-derivative.service"
import type { Passage } from "@/services/scripture-passage.service"
import { notRestrictedFromWatchWhere } from "@/services/search-watchability"
import {
  listVideoMoments,
  type VideoMomentView,
} from "@/services/video-moments.service"
import {
  VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS,
  VideoLookupValidationError as VideoLookupValidationErrorClass,
} from "@/services/video.service"
import type {
  ChildDubLanguageRow,
  WatchCollectionFeed,
  WatchCollectionFeedItem,
  WatchCollectionFeedNode,
  WatchCollectionFeedPageInfo,
  WatchLanguageInventory,
  WatchLanguageInventoryCounts,
  WatchLanguageInventoryItem,
  WatchLanguageInventoryLanguage,
  WatchRouteSnapshot,
  WatchRouteSnapshotBibleBook,
  WatchRouteSnapshotBibleCitation,
  WatchRouteSnapshotChild,
  WatchRouteSnapshotChildRelation,
  WatchRouteSnapshotImage,
  WatchRouteSnapshotLanguage,
  WatchRouteSnapshotLocale,
  WatchRouteSnapshotParent,
  WatchRouteSnapshotParentRelation,
  WatchRouteSnapshotPreferredVariant,
  WatchRouteSnapshotSocialImage,
  WatchRouteSnapshotStudyQuestion,
  VideoMapperCatalogConnection,
  VideoMapperCatalogItem,
  VideoMapperCatalogPageInfo,
  VideoForEnrichment,
} from "@/services/video.service"

// Principal-aware relation filters — extracted so the per-principal /
// per-locale shape is unit-testable. EDITOR/ADMIN see everything;
// anonymous and VIEWER callers see PUBLISHED-only (mirroring
// `Experience.locales` per
// `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`).
// For `parents`/`children`, "PUBLISHED" means the related Video itself
// has at least one PUBLISHED locale AND is not soft-deleted.

export function videoLocalesFilter(
  args: { locale?: string | null; languageSlug?: string | null },
  user: Principal | null,
):
  | {
      where: Prisma.VideoLocaleWhereInput
      orderBy: Prisma.VideoLocaleOrderByWithRelationInput[]
    }
  | Record<string, never> {
  // Treat empty string the same as missing — caller intent is "no locale
  // filter," not "narrow to the zero-length locale code" (which would match
  // zero rows).
  const locale =
    typeof args.locale === "string" && args.locale.length > 0
      ? args.locale
      : null
  const languageSlug =
    typeof args.languageSlug === "string" && args.languageSlug.length > 0
      ? args.languageSlug
      : null
  const localeFilter = locale != null ? { locale } : {}
  const languageSlugFilter = languageSlug != null ? { languageSlug } : {}
  const visibleFilter = {
    deletedAt: null,
    ...localeFilter,
    ...languageSlugFilter,
  }
  const orderBy = [{ languageSlug: "asc" as const }, { id: "asc" as const }]
  if (isEditorOrAdmin(user)) {
    return { where: visibleFilter, orderBy }
  }
  return {
    where: { status: "PUBLISHED" as const, ...visibleFilter },
    orderBy,
  }
}

export function videoStudyQuestionsFilter(args: {
  locale?: string | null
  languageSlug?: string | null
}): {
  where: Prisma.VideoStudyQuestionWhereInput
  orderBy: Prisma.VideoStudyQuestionOrderByWithRelationInput[]
} {
  const locale =
    typeof args.locale === "string" && args.locale.length > 0
      ? args.locale
      : null
  const languageSlug =
    typeof args.languageSlug === "string" && args.languageSlug.length > 0
      ? args.languageSlug
      : null
  return {
    where: {
      deletedAt: null,
      ...(locale != null
        ? { locale }
        : languageSlug == null
          ? { primary: true }
          : {}),
      ...(languageSlug != null ? { languageSlug } : {}),
    },
    orderBy: [
      { order: "asc" as const },
      { languageSlug: "asc" as const },
      { id: "asc" as const },
    ],
  }
}

const videoRelationOrderBy = [
  { order: { sort: "asc" as const, nulls: "last" as const } },
  { createdAt: "asc" as const },
  { id: "asc" as const },
] satisfies Prisma.VideoRelationOrderByWithRelationInput[]

type VideoRelationQuery = {
  where?: Prisma.VideoRelationWhereInput
  orderBy: Prisma.VideoRelationOrderByWithRelationInput[]
}

export function videoParentsFilter(user: Principal | null): VideoRelationQuery {
  if (isEditorOrAdmin(user)) return { orderBy: videoRelationOrderBy }
  return {
    where: {
      parent: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" as const, deletedAt: null } },
        ...notRestrictedFromWatchWhere(),
      },
    },
    orderBy: videoRelationOrderBy,
  }
}

export function videoChildrenFilter(
  user: Principal | null,
): VideoRelationQuery {
  if (isEditorOrAdmin(user)) return { orderBy: videoRelationOrderBy }
  return {
    where: {
      child: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" as const, deletedAt: null } },
        ...notRestrictedFromWatchWhere(),
      },
    },
    orderBy: videoRelationOrderBy,
  }
}

export const VideoLabelEnum = builder.enumType("VideoLabel", {
  values: {
    COLLECTION: { value: "COLLECTION" },
    EPISODE: { value: "EPISODE" },
    FEATURE_FILM: { value: "FEATURE_FILM" },
    SEGMENT: { value: "SEGMENT" },
    SERIES: { value: "SERIES" },
    SHORT_FILM: { value: "SHORT_FILM" },
    TRAILER: { value: "TRAILER" },
    BEHIND_THE_SCENES: { value: "BEHIND_THE_SCENES" },
  } as const,
})

const VideoSourceEnum = builder.enumType("VideoSourceHost", {
  description:
    "Where the playable media is hosted. Named `VideoSourceHost` to avoid collision with the provenance `SourceTier` (`CORE` | `MANAGER`).",
  values: {
    INTERNAL: { value: "INTERNAL" },
    YOUTUBE: { value: "YOUTUBE" },
    CLOUDFLARE: { value: "CLOUDFLARE" },
    MUX: { value: "MUX" },
  } as const,
})

const VideoMapperCatalogMediaSourceTypeEnum = builder.enumType(
  "VideoMapperCatalogMediaSourceType",
  {
    description: "Primary media source selected for mapper catalog indexing.",
    values: {
      DOWNLOAD: { value: "DOWNLOAD" },
      HLS: { value: "HLS" },
      DASH: { value: "DASH" },
      NONE: { value: "NONE" },
    } as const,
  },
)

const WatchLanguageInventoryAvailabilityEnum = builder.enumType(
  "WatchLanguageInventoryAvailability",
  {
    description:
      "Whether the requested language has playable audio or subtitles only for this inventory row.",
    values: {
      AUDIO: { value: "AUDIO" },
      SUBTITLE_ONLY: { value: "SUBTITLE_ONLY" },
    } as const,
  },
)

/** @classification public-shape */
builder.prismaObject("VideoOrigin", {
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.exposeString("name"),
    description: t.exposeString("description", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoEdition", {
  description:
    "A specific cut of a Video. Subtitles + dubs attach here because timecodes and audio are per-cut.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.exposeString("name"),
    dubs: t.relation("dubs", {
      query: { where: { deletedAt: null } },
    }),
    subtitles: t.relation("subtitles", {
      query: { where: { deletedAt: null } },
    }),
  }),
})

/** @classification public-shape */
builder.prismaObject("MuxVideo", {
  description:
    "Mux asset metadata. MuxVideo.duration is always 0 in legacy data — canonical duration lives on VideoDub.lengthInMilliseconds.",
  fields: (t) => ({
    id: t.exposeID("id"),
    assetId: t.exposeString("assetId", { nullable: true }),
    playbackId: t.exposeString("playbackId", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("BibleBook", {
  description: "A Core-sourced Bible book reference used by video citations.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.field({ type: "JSON", resolve: (row) => row.name }),
    osisId: t.exposeString("osisId", { nullable: true }),
    alternateName: t.exposeString("alternateName", { nullable: true }),
    paratextAbbreviation: t.exposeString("paratextAbbreviation", {
      nullable: true,
    }),
    isNewTestament: t.exposeBoolean("isNewTestament", { nullable: true }),
    order: t.exposeInt("order", { nullable: true }),
    testament: t.exposeString("testament", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoSubtitle", {
  fields: (t) => ({
    id: t.exposeID("id"),
    value: t.exposeString("value", { nullable: true }),
    primary: t.exposeBoolean("primary"),
    vttSrc: t.exposeString("vttSrc", { nullable: true }),
    srtSrc: t.exposeString("srtSrc", { nullable: true }),
    aiGenerated: t.exposeBoolean("aiGenerated"),
    video: t.relation("video", { nullable: true }),
    language: t.relation("language", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoDubDownload", {
  description: "A downloadable quality tier for a Core-sourced video dub.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId", { nullable: true }),
    quality: t.exposeString("quality", { nullable: true }),
    url: t.exposeString("url", { nullable: true }),
    size: t.string({
      nullable: true,
      resolve: (row) => (row.size == null ? null : row.size.toString()),
    }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    bitrate: t.exposeInt("bitrate", { nullable: true }),
  }),
})

// VideoDub — formerly VideoVariant; see migration 0006 + apps/admin/CLAUDE.md.

/** @classification public-shape */
builder.prismaObject("VideoDub", {
  description:
    "A language-specific audio dub of an Edition, bundled with its encoded playback (HLS/DASH/Mux). lengthInMilliseconds is BigInt — int4 truncates at 596 hours.",
  fields: (t) => ({
    id: t.exposeID("id"),
    videoId: t.exposeString("videoId"),
    coreId: t.exposeString("coreId"),
    slug: t.exposeString("slug", { nullable: true }),
    duration: t.exposeInt("duration", { nullable: true }),
    // BigInt → String to avoid precision loss above 2^53.
    lengthInMilliseconds: t.string({
      nullable: true,
      resolve: (row) =>
        row.lengthInMilliseconds == null
          ? null
          : row.lengthInMilliseconds.toString(),
    }),
    hls: t.exposeString("hls", { nullable: true }),
    dash: t.exposeString("dash", { nullable: true }),
    share: t.exposeString("share", { nullable: true }),
    downloadable: t.exposeBoolean("downloadable"),
    published: t.exposeBoolean("published"),
    brightcoveId: t.exposeString("brightcoveId", { nullable: true }),
    aiGenerated: t.exposeBoolean("aiGenerated"),
    language: t.relation("language", { nullable: true }),
    videoEdition: t.relation("videoEdition", { nullable: true }),
    muxVideo: t.relation("muxVideo", { nullable: true }),
    muxHeroPosterBlurDataUrl: t.string({
      nullable: true,
      description:
        "Base64 blur data URL for the Watch hero poster Mux thumbnail recipe. Lazily generated and stored in mux_image_derivative by playback id + recipe.",
      resolve: async (dub, _args, ctx) => {
        const muxVideo = await ctx.prisma.muxVideo.findFirst({
          where: {
            dubs: { some: { id: dub.id } },
            playbackId: { not: null },
            deletedAt: null,
          },
          select: { id: true, playbackId: true },
        })
        if (!muxVideo?.playbackId) return null
        return getOrScheduleWatchHeroPosterMuxBlurDataUrl({
          prisma: ctx.prisma,
          muxVideoId: muxVideo.id,
          playbackId: muxVideo.playbackId,
        })
      },
    }),
    muxHeroPosterDominantColor: t.string({
      nullable: true,
      description:
        "Dominant color for the Watch hero poster Mux thumbnail recipe. Lazily generated and stored with the matching Mux image derivative.",
      resolve: async (dub, _args, ctx) => {
        const muxVideo = await ctx.prisma.muxVideo.findFirst({
          where: {
            dubs: { some: { id: dub.id } },
            playbackId: { not: null },
            deletedAt: null,
          },
          select: { id: true, playbackId: true },
        })
        if (!muxVideo?.playbackId) return null
        return getOrScheduleWatchHeroPosterMuxDominantColor({
          prisma: ctx.prisma,
          muxVideoId: muxVideo.id,
          playbackId: muxVideo.playbackId,
        })
      },
    }),
    downloads: t.relation("downloads", {
      query: { where: { deletedAt: null } },
    }),
  }),
})

/** @classification public-shape */
const VideoMomentRef = builder.objectRef<VideoMomentView>("VideoMoment")

VideoMomentRef.implement({
  description:
    "A transcript-derived moment of this video: timing (null when the transcript chunker had no timecodes — clients must treat untimed rows as list items, never as second 0), an enriched summary of the span, and the Bible references the enrichment attached to it. The lean projection behind TV's in-player companion panel; the chunk's text and embedding stay backend-only.",
  fields: (t) => ({
    startSeconds: t.exposeFloat("startSeconds", { nullable: true }),
    endSeconds: t.exposeFloat("endSeconds", { nullable: true }),
    summary: t.exposeString("summary", { nullable: true }),
    bibleVerses: t.exposeStringList("bibleVerses"),
  }),
})

/** @classification public-shape */
const PassageRef = builder.objectRef<Passage>("Passage")

PassageRef.implement({
  description:
    "Cached Bible passage text for a video citation, fetched server-side from an approved provider.",
  fields: (t) => ({
    content: t.exposeString("content"),
    copyright: t.exposeString("copyright"),
    humanReference: t.exposeString("humanReference"),
    provider: t.exposeString("provider"),
    publisherUrl: t.exposeString("publisherUrl", { nullable: true }),
    reference: t.exposeString("reference"),
    versionAbbreviation: t.exposeString("versionAbbreviation", {
      nullable: true,
    }),
    versionId: t.exposeInt("versionId"),
    versionTitle: t.exposeString("versionTitle", { nullable: true }),
  }),
})

/** @classification public-shape */
const BibleCitationRef = builder.prismaObject("BibleCitation", {
  description: "A Core-sourced Bible passage cited by a video.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId", { nullable: true }),
    osisId: t.exposeString("osisId", { nullable: true }),
    order: t.exposeInt("order", { nullable: true }),
    chapterStart: t.exposeInt("chapterStart", { nullable: true }),
    chapterEnd: t.exposeInt("chapterEnd", { nullable: true }),
    verseStart: t.exposeInt("verseStart", { nullable: true }),
    verseEnd: t.exposeInt("verseEnd", { nullable: true }),
    bibleBook: t.relation("bibleBook"),
    passage: t.field({
      type: PassageRef,
      nullable: true,
      description:
        "Server-resolved Bible text for this citation. Returns null when no approved provider key is configured, the citation cannot be mapped, or the provider is unavailable.",
      args: {
        languageId: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (citation, args, ctx) =>
        ctx.services.scripturePassage.getPassageForCitation({
          citationId: citation.id,
          languageId: args.languageId ?? null,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
  }),
})

/** @classification public-shape */
const VideoImageRef = builder.prismaObject("VideoImage", {
  fields: (t) => ({
    id: t.exposeID("id"),
    url: t.exposeString("url", { nullable: true }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    aspectRatio: t.exposeString("aspectRatio", { nullable: true }),
    mobileCinematicHigh: t.exposeString("mobileCinematicHigh", {
      nullable: true,
    }),
    mobileCinematicLow: t.exposeString("mobileCinematicLow", {
      nullable: true,
    }),
    mobileCinematicVeryLow: t.exposeString("mobileCinematicVeryLow", {
      nullable: true,
    }),
    thumbnail: t.exposeString("thumbnail", { nullable: true }),
    videoStill: t.exposeString("videoStill", { nullable: true }),
    blurDataUrl: t.exposeString("blurDataUrl", { nullable: true }),
    dominantColor: t.exposeString("dominantColor", { nullable: true }),
    kind: t.exposeString("kind", { nullable: true }),
  }),
})

/** @classification public-shape */
const VideoLocaleRef = builder.prismaObject("VideoLocale", {
  description: "Per-locale title/description/snippet/imageAlt for a Video.",
  fields: (t) => ({
    id: t.exposeID("id"),
    locale: t.exposeString("locale", { nullable: true }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    languageCoreId: t.exposeString("languageCoreId", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    snippet: t.exposeString("snippet", { nullable: true }),
    imageAlt: t.exposeString("imageAlt", { nullable: true }),
    status: t.expose("status", { type: LocaleStatusEnum }),
    language: t.relation("language", { nullable: true }),
    publishedAt: t.string({
      nullable: true,
      resolve: (row) => row.publishedAt?.toISOString() ?? null,
    }),
  }),
})

/** @classification public-shape */
const VideoStudyQuestionRef = builder.prismaObject("VideoStudyQuestion", {
  description: "A per-locale Core-sourced study question attached to a video.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId", { nullable: true }),
    locale: t.exposeString("locale", { nullable: true }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    languageCoreId: t.exposeString("languageCoreId", { nullable: true }),
    text: t.exposeString("text"),
    primary: t.exposeBoolean("primary"),
    order: t.exposeInt("order", { nullable: true }),
    language: t.relation("language", { nullable: true }),
  }),
})

/** @classification public-shape */
const VideoRelationRef = builder.prismaObject("VideoRelation", {
  description:
    "Self-referential parent/child join between Videos (e.g. series→episode). Exposes the related parent/child Video plus its ordering position.",
  fields: (t) => ({
    id: t.exposeID("id"),
    order: t.exposeInt("order", { nullable: true }),
    parent: t.prismaField({
      type: "Video",
      nullable: true,
      resolve: (query, relation, _args, ctx) =>
        ctx.loaders.videoByIdWithQuery.load({ id: relation.parentId, query }),
    }),
    child: t.prismaField({
      type: "Video",
      nullable: true,
      resolve: (query, relation, _args, ctx) =>
        ctx.loaders.videoByIdWithQuery.load({ id: relation.childId, query }),
    }),
  }),
})

// ChildDubLanguage — a computed projection (not a prismaObject), so it's
// invisible to classification.test.ts's prismaObject/t.relation walker by
// construction (same posture as VideoForEnrichment below). It carries no
// abac-gated data: only the public language display fields the /series-page
// picker needs. Deliberately minimal — the picker navigates by slug, so a
// dub's id/hls/duration are not projected (kept the per-language payload
// small enough that aggregating ~2,200 languages stays well under budget).

const ChildDubLanguageRef =
  builder.objectRef<ChildDubLanguageRow>("ChildDubLanguage")

ChildDubLanguageRef.implement({
  description:
    "One distinct playable dub language available across a parent video's children. Drives the /series-page language picker. Every entry is guaranteed playable (published + streamable) — consumers need no further filtering.",
  fields: (t) => ({
    slug: t.exposeString("slug", { nullable: true }),
    name: t.field({
      type: "JSON",
      nullable: true,
      description:
        "Compatibility JSON map of locale code → name (mirrors Language.name).",
      resolve: (row) => row.name,
    }),
    bcp47: t.exposeString("bcp47", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("Video", {
  description:
    "A video sourced from JesusFilm Core. Read-only at the GraphQL layer in v1.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    slug: t.exposeString("slug"),
    label: t.expose("label", { type: VideoLabelEnum, nullable: true }),
    videoSource: t.expose("videoSource", {
      type: VideoSourceEnum,
      nullable: true,
    }),
    publishedAt: t.string({
      nullable: true,
      resolve: (row) => row.publishedAt?.toISOString() ?? null,
    }),
    locked: t.exposeBoolean("locked"),
    noIndex: t.exposeBoolean("noIndex"),
    restrictViewPlatforms: t.exposeStringList("restrictViewPlatforms", {
      description:
        'Core Platform slugs (e.g. "watch", "arclight") this video is restricted from viewing on. Synced read-only from Core; does not itself gate any public field — see search-watchability.ts and the public video resolvers for enforcement.',
    }),
    aiMetadata: t.exposeBoolean("aiMetadata"),
    primaryLanguage: t.relation("primaryLanguage", { nullable: true }),
    origin: t.relation("origin", { nullable: true }),
    durationSeconds: t.int({
      nullable: true,
      description:
        "Primary playable VideoDub duration in seconds, or null when the video has no playable dub (e.g. a SERIES/COLLECTION whose runtime lives on its children). Picks the primary-language playable dub, else the longest. Lets watch/series carousels render a per-chapter runtime pill via `children { child { durationSeconds } }` without projecting every child's full dub list. Batched per request through a DataLoader.",
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoPrimaryDubDurationById.load(video.id),
    }),
    muxPlaybackId: t.string({
      nullable: true,
      description:
        "Best playable Mux playback id for this video. When languageSlug is supplied, prefers a published + streamable dub in that language; otherwise falls back to the primary-language playable dub, then the longest playable dub. Lets Watch thumbnails build Mux frame images without projecting every child dub.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoMuxPlaybackIdByIdAndLanguageSlug.load({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    muxThumbnailBlurDataUrl: t.string({
      nullable: true,
      description:
        "Base64 blur data URL for the Watch chapter carousel Mux thumbnail recipe. Lazily generated and stored in mux_image_derivative by playback id + recipe.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoMuxThumbnailBlurDataUrlByIdAndLanguageSlug.load({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    muxThumbnailDominantColor: t.string({
      nullable: true,
      description:
        "Dominant color for the Watch chapter carousel Mux thumbnail recipe. Lazily generated and stored with the matching Mux image derivative.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoMuxThumbnailDominantColorByIdAndLanguageSlug.load({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    muxHeroPosterBlurDataUrl: t.string({
      nullable: true,
      description:
        "Base64 blur data URL for the Watch hero poster Mux thumbnail recipe. Lazily generated and stored in mux_image_derivative by playback id + recipe.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoMuxHeroPosterBlurDataUrlByIdAndLanguageSlug.load({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    muxHeroPosterDominantColor: t.string({
      nullable: true,
      description:
        "Dominant color for the Watch hero poster Mux thumbnail recipe. Lazily generated and stored with the matching Mux image derivative.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoMuxHeroPosterDominantColorByIdAndLanguageSlug.load({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    childDubLanguages: t.field({
      type: [ChildDubLanguageRef],
      nullable: false,
      description:
        "Distinct playable dub languages aggregated across this video's children (one representative dub per language). Empty for videos without children. Powers the /series-page language picker without projecting every child's full dub list — the ~45 MB / 137k-record payload that exceeds Next's unstable_cache 2 MB ceiling on the Jesus film (61 chapters × ~2,200 dubs). Respects the same child-visibility rules as `children`.",
      resolve: (video, _args, ctx) =>
        ctx.services.video.getChildDubLanguages({
          videoId: video.id,
          user: ctx.user,
        }),
    }),
    downloadableChildDubs: t.prismaField({
      type: ["VideoDub"],
      nullable: false,
      description:
        "One downloadable Dub per visible direct child for an exact language slug. Intended for lazy collection downloads without projecting every child Dub.",
      args: {
        languageSlug: t.arg.string({ required: true }),
      },
      resolve: (query, video, args, ctx) =>
        ctx.services.video.getDownloadableChildDubs({
          videoId: video.id,
          languageSlug: args.languageSlug,
          user: ctx.user,
          query,
        }),
    }),
    preferredPlayableDub: t.prismaField({
      type: "VideoDub",
      nullable: true,
      description:
        "One playable VideoDub for a Watch route. Prefers the requested language slug/BCP-47, then the video's primary language, then the longest playable dub. Lets consumer routes choose the initial player without projecting every dub.",
      args: {
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (query, video, args, ctx) =>
        ctx.services.video.getPreferredPlayableDub({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
          query,
        }),
    }),
    playableDubLanguageCount: t.int({
      nullable: false,
      description:
        "Distinct playable audio-language count for this video. Used by Watch to decide whether to render language switching without loading every VideoDub in the cold route snapshot.",
      resolve: (video, _args, ctx) =>
        ctx.services.video.countPlayableDubLanguages({ videoId: video.id }),
    }),
    locales: t.field({
      type: [VideoLocaleRef],
      nullable: true,
      description:
        "PUBLIC/VIEWER see PUBLISHED only; EDITOR/ADMIN see all. Pass `locale` to narrow the result to a single BCP-47 locale (web's WatchVideo fragment uses this to avoid overfetching every locale).",
      args: {
        locale: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoLocalesByVideoIdAndFilter.load({
          videoId: video.id,
          locale: args.locale ?? null,
          languageSlug: args.languageSlug ?? null,
          visibleOnly: !isEditorOrAdmin(ctx.user),
        }),
    }),
    dubs: t.relation("dubs", {
      query: { where: { deletedAt: null } },
    }),
    images: t.field({
      type: [VideoImageRef],
      nullable: true,
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoImagesByVideoId.load(video.id),
    }),
    studyQuestions: t.field({
      type: [VideoStudyQuestionRef],
      nullable: true,
      args: {
        locale: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (video, args, ctx) =>
        ctx.loaders.videoStudyQuestionsByVideoIdAndFilter.load({
          videoId: video.id,
          locale: args.locale ?? null,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
    bibleCitations: t.field({
      type: [BibleCitationRef],
      nullable: true,
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoBibleCitationsByVideoId.load(video.id),
    }),
    moments: t.field({
      type: [VideoMomentRef],
      description:
        "Transcript-derived moments in chunk order, capped server-side. Requested language falls back to English; [] when no transcript exists. Direct service call rather than a loader — the consumer (TV's watch record) asks for one video at a time, so there is nothing to batch.",
      args: {
        languageSlug: t.arg.string({ required: false }),
        limit: t.arg.int({ required: false }),
      },
      resolve: (video, args) =>
        listVideoMoments({
          videoId: video.id,
          languageSlug: args.languageSlug ?? null,
          limit: args.limit ?? null,
        }),
    }),
    parents: t.field({
      type: [VideoRelationRef],
      nullable: true,
      description:
        "Parent Video-Video relations: rows where this Video appears on the CHILD side of the VideoRelation join. Traverse `parent { … }` to read the foreign Video. PUBLIC/VIEWER see only relations whose parent has a PUBLISHED locale and is not soft-deleted; EDITOR/ADMIN see all.",
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoParentsByChildId.load({
          videoId: video.id,
          visibleOnly: !isEditorOrAdmin(ctx.user),
        }),
    }),
    children: t.field({
      type: [VideoRelationRef],
      nullable: true,
      description:
        "Child Video-Video relations: rows where this Video appears on the PARENT side of the VideoRelation join. Traverse `child { … }` to read the foreign Video. PUBLIC/VIEWER see only relations whose child has a PUBLISHED locale and is not soft-deleted; EDITOR/ADMIN see all.",
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoChildrenByParentId.load({
          videoId: video.id,
          visibleOnly: !isEditorOrAdmin(ctx.user),
        }),
    }),
  }),
})

/** @classification public-shape */
const WatchCollectionFeedItemRef = builder.objectRef<WatchCollectionFeedItem>(
  "WatchCollectionFeedItem",
)

WatchCollectionFeedItemRef.implement({
  description:
    "A localized, playback-resolved Watch card in a bounded collection feed page.",
  fields: (t) => ({
    id: t.exposeID("id", { nullable: false }),
    coreId: t.exposeString("coreId", { nullable: false }),
    title: t.exposeString("title", { nullable: false }),
    videoSlug: t.exposeString("videoSlug", { nullable: false }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    label: t.exposeString("label", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    blurDataUrl: t.exposeString("blurDataUrl", { nullable: true }),
    dominantColor: t.exposeString("dominantColor", { nullable: true }),
    muxPlaybackId: t.exposeString("muxPlaybackId", { nullable: true }),
  }),
})

/** @classification public-shape */
const WatchCollectionFeedNodeRef = builder.objectRef<WatchCollectionFeedNode>(
  "WatchCollectionFeedNode",
)

WatchCollectionFeedNodeRef.implement({
  description:
    "A visible localized collection parent and its bounded card-ready items.",
  fields: (t) => ({
    id: t.exposeID("id", { nullable: false }),
    slug: t.exposeString("slug", { nullable: false }),
    title: t.exposeString("title", { nullable: false }),
    description: t.exposeString("description", { nullable: true }),
    items: t.field({
      type: [WatchCollectionFeedItemRef],
      nullable: false,
      resolve: (row) => row.items,
    }),
  }),
})

/** @classification public-shape */
const WatchCollectionFeedPageInfoRef =
  builder.objectRef<WatchCollectionFeedPageInfo>("WatchCollectionFeedPageInfo")

WatchCollectionFeedPageInfoRef.implement({
  fields: (t) => ({
    endCursor: t.exposeString("endCursor", { nullable: true }),
    hasNextPage: t.exposeBoolean("hasNextPage", { nullable: false }),
  }),
})

/** @classification public-shape */
const WatchCollectionFeedRef = builder.objectRef<WatchCollectionFeed>(
  "WatchCollectionFeed",
)

WatchCollectionFeedRef.implement({
  description:
    "Cursor-paginated Watch collection parents used by the homepage infinite discovery feed.",
  fields: (t) => ({
    nodes: t.field({
      type: [WatchCollectionFeedNodeRef],
      nullable: false,
      resolve: (row) => row.nodes,
    }),
    pageInfo: t.field({
      type: WatchCollectionFeedPageInfoRef,
      nullable: false,
      resolve: (row) => row.pageInfo,
    }),
  }),
})

// VideoForEnrichment — service-mediated projection of dispatch fields
// (muxAssetId, subtitleUrl, primaryLanguageBcp47, label) consumed by
// manager's `/api/admin-trigger/{scene-analysis,transcript}` handler.
// Replaces the Strapi `videos(filters: { coreId: { in } })` lookup
// manager used to issue before feat-125.
//
// @classification public-shape
//
// The picker logic ("best primary-language variant + subtitle") lives
// in `services/video.service.ts::getByCoreIds` so manager does not
// re-implement it. classification.test.ts walks `prismaObject` +
// `t.relation` only, so this objectRef is invisible to its walker by
// construction.

const VideoForEnrichmentRef =
  builder.objectRef<VideoForEnrichment>("VideoForEnrichment")

VideoForEnrichmentRef.implement({
  description:
    "Dispatch-fields projection for manager's admin-trigger enrichment lookup. Fields are nullable so manager can distinguish missing primary language or mux validation blockers from an optional subtitle fast path.",
  fields: (t) => ({
    // `nullable: false` is required on objectRef-based types —
    // Pothos cannot infer non-nullability from the TS shape the
    // way prismaObject can from the Prisma schema. Dropping these
    // would silently flip the SDL to `String` / `ID` (nullable).
    id: t.exposeID("id", {
      nullable: false,
      description: "Admin's Video.id (cuid).",
    }),
    coreId: t.exposeString("coreId", {
      nullable: false,
      description: "Core's stable identifier for the video.",
    }),
    label: t.exposeString("label", {
      nullable: true,
      description:
        "VideoLabel as the camelCase wire-shape string ('featureFilm', 'shortFilm', 'behindTheScenes', etc.) — normalized from Prisma's TS enum identifier so manager's downstream LLM prompt stays byte-identical to the pre-feat-125 Strapi shape.",
    }),
    targetLocale: t.exposeString("targetLocale", {
      nullable: true,
      description:
        "Requested target locale used for this dispatch lookup; null when the primary-language source projection was requested.",
    }),
    primaryLanguageBcp47: t.exposeString("primaryLanguageBcp47", {
      nullable: true,
      description:
        "BCP-47 tag of the video's primary language; null when unattested.",
    }),
    languageBcp47: t.exposeString("languageBcp47", {
      nullable: true,
      description:
        "BCP-47 tag of the actual dispatch media language. Equals the primary language for source dispatches and the requested target language for localized dispatches when available.",
    }),
    muxAssetId: t.exposeString("muxAssetId", {
      nullable: true,
      description:
        "Mux assetId of the selected dispatch dub; null when no matching variant exists.",
    }),
    subtitleUrl: t.exposeString("subtitleUrl", {
      nullable: true,
      description:
        "VTT URL of the best selected-language subtitle (primary + non-AI preferred); null when no candidate exists.",
    }),
  }),
})

// VideoMapperCatalog* — service-mediated projection for mapper sync.
//
// @classification public-shape
//
// The auth boundary lives on Query.videoMapperCatalog via the dedicated
// `read:video-mapper-catalog` permission. classification.test.ts walks
// prismaObject + t.relation only, so objectRefs stay manually tagged.

const VideoMapperCatalogItemRef = builder.objectRef<VideoMapperCatalogItem>(
  "VideoMapperCatalogItem",
)

VideoMapperCatalogItemRef.implement({
  description:
    "Flat VideoDub-level projection for yt-video-mapper catalog sync. Uses Core-facing `coreId` and `videoVariantId` terminology while retaining Admin ids for diagnostics.",
  fields: (t) => ({
    coreId: t.exposeString("coreId", {
      nullable: false,
      description: "Admin Video.coreId: the canonical source video answer.",
    }),
    sourceTitle: t.exposeString("sourceTitle", {
      nullable: false,
      description:
        "Selected source-video title for the mapper's lightweight coreId/title map.",
    }),
    sourceTitleLocale: t.exposeString("sourceTitleLocale", {
      nullable: true,
      description:
        "Locale of the selected source title, null when the title fell back to slug/coreId.",
    }),
    videoVariantId: t.exposeString("videoVariantId", {
      nullable: false,
      description: "Core videoVariant.id, stored in Admin as VideoDub.coreId.",
    }),
    adminVideoId: t.exposeID("adminVideoId", {
      nullable: false,
      description: "Admin Video.id for diagnostics.",
    }),
    adminDubId: t.exposeID("adminDubId", {
      nullable: false,
      description: "Admin VideoDub.id for diagnostics and cursor ordering.",
    }),
    languageId: t.exposeString("languageId", {
      nullable: true,
      description: "Core Language.coreId for the dub language.",
    }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    locale: t.exposeString("locale", {
      nullable: true,
      description: "BCP-47 tag for the dub language.",
    }),
    editionCoreId: t.exposeString("editionCoreId", { nullable: true }),
    editionName: t.exposeString("editionName", { nullable: true }),
    durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
    lengthInMilliseconds: t.exposeString("lengthInMilliseconds", {
      nullable: true,
    }),
    hlsUrl: t.exposeString("hlsUrl", { nullable: true }),
    dashUrl: t.exposeString("dashUrl", { nullable: true }),
    shareUrl: t.exposeString("shareUrl", {
      nullable: true,
      description:
        "Share/playback URL exposed for diagnostics. Not selected as mediaSourceUrl in YTM-002 because mapper MediaSourceType has no SHARE value.",
    }),
    downloadUrl: t.exposeString("downloadUrl", { nullable: true }),
    downloadQuality: t.exposeString("downloadQuality", { nullable: true }),
    downloadWidth: t.exposeInt("downloadWidth", { nullable: true }),
    downloadHeight: t.exposeInt("downloadHeight", { nullable: true }),
    mediaSourceType: t.field({
      type: VideoMapperCatalogMediaSourceTypeEnum,
      nullable: false,
      resolve: (row) => row.mediaSourceType,
    }),
    mediaSourceUrl: t.exposeString("mediaSourceUrl", { nullable: true }),
    videoPublished: t.exposeBoolean("videoPublished", { nullable: false }),
    dubPublished: t.exposeBoolean("dubPublished", { nullable: false }),
    videoNoIndex: t.exposeBoolean("videoNoIndex", { nullable: false }),
    videoDeleted: t.exposeBoolean("videoDeleted", { nullable: false }),
    dubDeleted: t.exposeBoolean("dubDeleted", { nullable: false }),
    deletedAt: t.exposeString("deletedAt", { nullable: true }),
    indexable: t.exposeBoolean("indexable", { nullable: false }),
    nonIndexableReason: t.exposeString("nonIndexableReason", {
      nullable: true,
      description: `Machine-readable reason when indexable=false. Current values: ${VIDEO_MAPPER_CATALOG_NON_INDEXABLE_REASONS.join(", ")}.`,
    }),
  }),
})

const VideoMapperCatalogPageInfoRef =
  builder.objectRef<VideoMapperCatalogPageInfo>("VideoMapperCatalogPageInfo")

VideoMapperCatalogPageInfoRef.implement({
  description: "Forward cursor pagination state for mapper catalog sync.",
  fields: (t) => ({
    startCursor: t.exposeString("startCursor", { nullable: true }),
    endCursor: t.exposeString("endCursor", { nullable: true }),
    hasNextPage: t.exposeBoolean("hasNextPage", { nullable: false }),
  }),
})

const VideoMapperCatalogConnectionRef =
  builder.objectRef<VideoMapperCatalogConnection>(
    "VideoMapperCatalogConnection",
  )

VideoMapperCatalogConnectionRef.implement({
  description:
    "Bounded page of flat mapper catalog rows. Does not expose nested Video or VideoDub relation graphs.",
  fields: (t) => ({
    nodes: t.field({
      type: [VideoMapperCatalogItemRef],
      nullable: false,
      resolve: (row) => row.nodes,
    }),
    pageInfo: t.field({
      type: VideoMapperCatalogPageInfoRef,
      nullable: false,
      resolve: (row) => row.pageInfo,
    }),
  }),
})

// WatchLanguageInventory* — public, flat read model for Watch's localized
// /videos page. It intentionally returns card-ready rows rather than nested
// Video relation graphs, keeping the payload bounded by availability bucket.

const WatchLanguageInventoryLanguageRef =
  builder.objectRef<WatchLanguageInventoryLanguage>(
    "WatchLanguageInventoryLanguage",
  )

WatchLanguageInventoryLanguageRef.implement({
  description: "Requested public Watch language for a localized inventory.",
  fields: (t) => ({
    slug: t.exposeString("slug", { nullable: false }),
    bcp47: t.exposeString("bcp47", { nullable: true }),
    name: t.field({
      type: "JSON",
      nullable: true,
      resolve: (row) => row.name,
    }),
  }),
})

const WatchLanguageInventoryItemRef =
  builder.objectRef<WatchLanguageInventoryItem>("WatchLanguageInventoryItem")

WatchLanguageInventoryItemRef.implement({
  description:
    "Card-ready Watch inventory row for a single video or parent collection in one requested language.",
  fields: (t) => ({
    id: t.exposeID("id", { nullable: false }),
    coreId: t.exposeString("coreId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: false }),
    title: t.exposeString("title", { nullable: false }),
    description: t.exposeString("description", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    imageAlt: t.exposeString("imageAlt", { nullable: true }),
    muxPlaybackId: t.exposeString("muxPlaybackId", {
      nullable: true,
      description:
        "Mux playback id of the row's best published dub. Lets consumers synthesize a frame thumbnail when `imageUrl` is null because the video carries no authored artwork.",
    }),
    label: t.exposeString("label", {
      nullable: true,
      description:
        "VideoLabel as the camelCase database wire-shape string ('featureFilm', 'shortFilm', etc.).",
    }),
    availability: t.field({
      type: WatchLanguageInventoryAvailabilityEnum,
      nullable: false,
      resolve: (row) => row.availability,
    }),
    watchLanguageSlug: t.exposeString("watchLanguageSlug", {
      nullable: false,
      description:
        "Public Watch audio-language slug to use in hrefs. Equals the requested language for audio rows; subtitle-only rows use a playable fallback audio language.",
    }),
    parentSlug: t.exposeString("parentSlug", { nullable: true }),
    parentTitle: t.exposeString("parentTitle", { nullable: true }),
    parentOrder: t.exposeInt("parentOrder", {
      nullable: true,
      description:
        "Zero-based order of this video inside the selected parent collection. Null for standalone videos and parent collection rows.",
    }),
    durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
    childCount: t.exposeInt("childCount", { nullable: false }),
    publishedAt: t.exposeString("publishedAt", { nullable: true }),
    createdAt: t.exposeString("createdAt", { nullable: true }),
    updatedAt: t.exposeString("updatedAt", { nullable: true }),
  }),
})

const WatchLanguageInventoryCountsRef =
  builder.objectRef<WatchLanguageInventoryCounts>(
    "WatchLanguageInventoryCounts",
  )

WatchLanguageInventoryCountsRef.implement({
  description: "Complete counts for the localized Watch inventory buckets.",
  fields: (t) => ({
    audioCollections: t.exposeInt("audioCollections", { nullable: false }),
    audioVideos: t.exposeInt("audioVideos", { nullable: false }),
    subtitleOnlyVideos: t.exposeInt("subtitleOnlyVideos", {
      nullable: false,
    }),
    total: t.exposeInt("total", { nullable: false }),
  }),
})

const WatchLanguageInventoryRef = builder.objectRef<WatchLanguageInventory>(
  "WatchLanguageInventory",
)

WatchLanguageInventoryRef.implement({
  description:
    "Localized Watch inventory grouped for regional leads: audio collections, audio videos, then subtitle-only videos.",
  fields: (t) => ({
    language: t.field({
      type: WatchLanguageInventoryLanguageRef,
      nullable: true,
      resolve: (row) => row.language,
    }),
    counts: t.field({
      type: WatchLanguageInventoryCountsRef,
      nullable: false,
      resolve: (row) => row.counts,
    }),
    promoted: t.field({
      type: [WatchLanguageInventoryItemRef],
      nullable: false,
      resolve: (row) => row.promoted,
    }),
    audioCollections: t.field({
      type: [WatchLanguageInventoryItemRef],
      nullable: false,
      resolve: (row) => row.audioCollections,
    }),
    audioVideos: t.field({
      type: [WatchLanguageInventoryItemRef],
      nullable: false,
      resolve: (row) => row.audioVideos,
    }),
    subtitleOnlyVideos: t.field({
      type: [WatchLanguageInventoryItemRef],
      nullable: false,
      resolve: (row) => row.subtitleOnlyVideos,
    }),
  }),
})

// WatchRouteSnapshot* — public, route-shaped read model for the hot
// /watch/[collection]/[video]/[language] page. It deliberately mirrors the
// web's cold route DTO instead of exposing a nested Prisma graph.

const WatchRouteSnapshotImageRef = builder.objectRef<WatchRouteSnapshotImage>(
  "WatchRouteSnapshotImage",
)

WatchRouteSnapshotImageRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    url: t.exposeString("url", { nullable: true }),
    thumbnail: t.exposeString("thumbnail", { nullable: true }),
    mobileCinematicHigh: t.exposeString("mobileCinematicHigh", {
      nullable: true,
    }),
    mobileCinematicLow: t.exposeString("mobileCinematicLow", {
      nullable: true,
    }),
    dominantColor: t.exposeString("dominantColor", { nullable: true }),
  }),
})

const WatchRouteSnapshotLanguageRef =
  builder.objectRef<WatchRouteSnapshotLanguage>("WatchRouteSnapshotLanguage")

WatchRouteSnapshotLanguageRef.implement({
  fields: (t) => ({
    coreId: t.exposeString("coreId", { nullable: true }),
    bcp47: t.exposeString("bcp47", { nullable: true }),
    slug: t.exposeString("slug", { nullable: true }),
    name: t.field({
      type: "JSON",
      nullable: true,
      resolve: (row) => row.name ?? null,
    }),
  }),
})

const WatchRouteSnapshotSocialImageRef =
  builder.objectRef<WatchRouteSnapshotSocialImage>(
    "WatchRouteSnapshotSocialImage",
  )

WatchRouteSnapshotSocialImageRef.implement({
  description:
    "Crawler-safe projection of a public, ready Media Library image.",
  fields: (t) => ({
    url: t.exposeString("url", { nullable: false }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    mimeType: t.exposeString("mimeType", { nullable: true }),
  }),
})

const WatchRouteSnapshotLocaleRef = builder.objectRef<WatchRouteSnapshotLocale>(
  "WatchRouteSnapshotLocale",
)

WatchRouteSnapshotLocaleRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    publishedAt: t.exposeString("publishedAt", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    snippet: t.exposeString("snippet", { nullable: true }),
    imageAlt: t.exposeString("imageAlt", { nullable: true }),
    searchTitle: t.exposeString("searchTitle", { nullable: true }),
    searchDescription: t.exposeString("searchDescription", { nullable: true }),
    socialImage: t.field({
      type: WatchRouteSnapshotSocialImageRef,
      nullable: true,
      resolve: (row) => row.socialImage ?? null,
    }),
  }),
})

const WatchRouteSnapshotChildRef = builder.objectRef<WatchRouteSnapshotChild>(
  "WatchRouteSnapshotChild",
)

const WatchRouteSnapshotChildRelationRef =
  builder.objectRef<WatchRouteSnapshotChildRelation>(
    "WatchRouteSnapshotChildRelation",
  )

WatchRouteSnapshotChildRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: true }),
    label: t.field({
      type: VideoLabelEnum,
      nullable: true,
      resolve: (row) => row.label,
    }),
    images: t.field({
      type: [WatchRouteSnapshotImageRef],
      nullable: false,
      resolve: (row) => row.images,
    }),
    exactLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.exactLocales,
    }),
    broadLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.broadLocales,
    }),
    englishLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.englishLocales,
    }),
    durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
    muxPlaybackId: t.exposeString("muxPlaybackId", { nullable: true }),
    muxThumbnailBlurDataUrl: t.exposeString("muxThumbnailBlurDataUrl", {
      nullable: true,
    }),
    muxThumbnailDominantColor: t.exposeString("muxThumbnailDominantColor", {
      nullable: true,
    }),
    muxHeroPosterBlurDataUrl: t.exposeString("muxHeroPosterBlurDataUrl", {
      nullable: true,
    }),
    muxHeroPosterDominantColor: t.exposeString("muxHeroPosterDominantColor", {
      nullable: true,
    }),
  }),
})

WatchRouteSnapshotChildRelationRef.implement({
  fields: (t) => ({
    order: t.exposeInt("order", { nullable: true }),
    child: t.field({
      type: WatchRouteSnapshotChildRef,
      nullable: true,
      resolve: (row) => row.child,
    }),
  }),
})

const WatchRouteSnapshotParentRef = builder.objectRef<WatchRouteSnapshotParent>(
  "WatchRouteSnapshotParent",
)

const WatchRouteSnapshotParentRelationRef =
  builder.objectRef<WatchRouteSnapshotParentRelation>(
    "WatchRouteSnapshotParentRelation",
  )

WatchRouteSnapshotParentRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: true }),
    noIndex: t.exposeBoolean("noIndex", { nullable: true }),
    label: t.field({
      type: VideoLabelEnum,
      nullable: true,
      resolve: (row) => row.label,
    }),
    images: t.field({
      type: [WatchRouteSnapshotImageRef],
      nullable: false,
      resolve: (row) => row.images,
    }),
    exactLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.exactLocales,
    }),
    broadLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.broadLocales,
    }),
    englishLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.englishLocales,
    }),
    children: t.field({
      type: [WatchRouteSnapshotChildRelationRef],
      nullable: false,
      resolve: (row) => row.children,
    }),
  }),
})

WatchRouteSnapshotParentRelationRef.implement({
  fields: (t) => ({
    parent: t.field({
      type: WatchRouteSnapshotParentRef,
      nullable: true,
      resolve: (row) => row.parent,
    }),
  }),
})

const WatchRouteSnapshotBibleBookRef =
  builder.objectRef<WatchRouteSnapshotBibleBook>("WatchRouteSnapshotBibleBook")

WatchRouteSnapshotBibleBookRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    name: t.field({
      type: "JSON",
      nullable: true,
      resolve: (row) => row.name,
    }),
  }),
})

const WatchRouteSnapshotBibleCitationRef =
  builder.objectRef<WatchRouteSnapshotBibleCitation>(
    "WatchRouteSnapshotBibleCitation",
  )

WatchRouteSnapshotBibleCitationRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    chapterStart: t.exposeInt("chapterStart", { nullable: true }),
    chapterEnd: t.exposeInt("chapterEnd", { nullable: true }),
    verseStart: t.exposeInt("verseStart", { nullable: true }),
    verseEnd: t.exposeInt("verseEnd", { nullable: true }),
    order: t.exposeInt("order", { nullable: true }),
    osisId: t.exposeString("osisId", { nullable: true }),
    bibleBook: t.field({
      type: WatchRouteSnapshotBibleBookRef,
      nullable: true,
      resolve: (row) => row.bibleBook,
    }),
    passage: t.field({
      type: PassageRef,
      nullable: true,
      description:
        "Server-resolved Bible text for this citation. Returns null when no approved provider key is configured, the citation cannot be mapped, or the provider is unavailable.",
      args: {
        languageId: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      resolve: (row, args, ctx) =>
        ctx.services.scripturePassage.getPassageForCitation({
          citationId: row.documentId,
          languageId: args.languageId ?? null,
          languageSlug: args.languageSlug ?? null,
        }),
    }),
  }),
})

const WatchRouteSnapshotStudyQuestionRef =
  builder.objectRef<WatchRouteSnapshotStudyQuestion>(
    "WatchRouteSnapshotStudyQuestion",
  )

WatchRouteSnapshotStudyQuestionRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    languageSlug: t.exposeString("languageSlug", { nullable: true }),
    value: t.exposeString("value", { nullable: true }),
    order: t.exposeInt("order", { nullable: true }),
  }),
})

const WatchRouteSnapshotPreferredVariantRef =
  builder.objectRef<WatchRouteSnapshotPreferredVariant>(
    "WatchRouteSnapshotPreferredVariant",
  )

WatchRouteSnapshotPreferredVariantRef.implement({
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: true }),
    published: t.exposeBoolean("published", { nullable: true }),
    hls: t.exposeString("hls", { nullable: true }),
    duration: t.exposeInt("duration", { nullable: true }),
    language: t.field({
      type: WatchRouteSnapshotLanguageRef,
      nullable: true,
      resolve: (row) => row.language,
    }),
    muxHeroPosterBlurDataUrl: t.exposeString("muxHeroPosterBlurDataUrl", {
      nullable: true,
    }),
    muxHeroPosterDominantColor: t.exposeString("muxHeroPosterDominantColor", {
      nullable: true,
    }),
  }),
})

const WatchRouteSnapshotRef =
  builder.objectRef<WatchRouteSnapshot>("WatchRouteSnapshot")

WatchRouteSnapshotRef.implement({
  description:
    "Route-shaped Watch video snapshot assembled by the video service in bounded batches. Designed for the public Watch single-video cold path.",
  fields: (t) => ({
    documentId: t.exposeID("documentId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: true }),
    publishedAt: t.exposeString("publishedAt", { nullable: true }),
    noIndex: t.exposeBoolean("noIndex", { nullable: true }),
    label: t.field({
      type: VideoLabelEnum,
      nullable: true,
      resolve: (row) => row.label,
    }),
    images: t.field({
      type: [WatchRouteSnapshotImageRef],
      nullable: false,
      resolve: (row) => row.images,
    }),
    primaryLanguage: t.field({
      type: WatchRouteSnapshotLanguageRef,
      nullable: true,
      resolve: (row) => row.primaryLanguage,
    }),
    parents: t.field({
      type: [WatchRouteSnapshotParentRelationRef],
      nullable: false,
      resolve: (row) => row.parents,
    }),
    children: t.field({
      type: [WatchRouteSnapshotChildRelationRef],
      nullable: false,
      resolve: (row) => row.children,
    }),
    bibleCitations: t.field({
      type: [WatchRouteSnapshotBibleCitationRef],
      nullable: false,
      resolve: (row) => row.bibleCitations,
    }),
    exactLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.exactLocales,
    }),
    broadLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.broadLocales,
    }),
    englishLocales: t.field({
      type: [WatchRouteSnapshotLocaleRef],
      nullable: false,
      resolve: (row) => row.englishLocales,
    }),
    exactStudyQuestions: t.field({
      type: [WatchRouteSnapshotStudyQuestionRef],
      nullable: false,
      resolve: (row) => row.exactStudyQuestions,
    }),
    broadStudyQuestions: t.field({
      type: [WatchRouteSnapshotStudyQuestionRef],
      nullable: false,
      resolve: (row) => row.broadStudyQuestions,
    }),
    englishStudyQuestions: t.field({
      type: [WatchRouteSnapshotStudyQuestionRef],
      nullable: false,
      resolve: (row) => row.englishStudyQuestions,
    }),
    playableDubLanguageCount: t.exposeInt("playableDubLanguageCount", {
      nullable: false,
    }),
    preferredVariant: t.field({
      type: WatchRouteSnapshotPreferredVariantRef,
      nullable: true,
      resolve: (row) => row.preferredVariant,
    }),
  }),
})

// Root queries — PUBLIC since consumer-migration U2 (2026-05-11).
builder.queryFields((t) => ({
  video: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { public: true },
    description: "Fetch a single Video by id.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getById({
        id: String(args.id),
        query,
      }),
  }),
  videoBySlug: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { public: true },
    description: "Fetch a single Video by slug.",
    args: {
      slug: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getBySlug({
        slug: args.slug,
        query,
      }),
  }),
  watchVideoRouteSnapshotBySlug: t.field({
    type: WatchRouteSnapshotRef,
    nullable: true,
    authScopes: { public: true },
    description:
      "Fetch the public Watch single-video route snapshot by slug as a bounded, route-shaped DTO instead of a nested Video relation graph.",
    args: {
      slug: t.arg.string({ required: true }),
      locale: t.arg.string({ required: true }),
      languageSlug: t.arg.string({ required: false }),
      subtitleLanguageSlug: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.video.getWatchRouteSnapshotBySlug({
        slug: args.slug,
        locale: args.locale,
        languageSlug: args.languageSlug,
        subtitleLanguageSlug: args.subtitleLanguageSlug,
        user: ctx.user,
      }),
  }),
  videoDub: t.prismaField({
    type: "VideoDub",
    nullable: true,
    authScopes: { public: true },
    description:
      "Fetch a single VideoDub by id. Lets consumers lazily load one dub's downloads + subtitles (via `videoEdition { subtitles }`) without projecting every dub — mobile's watch screen uses this so switching language/opening the download or subtitle sheet fetches just the active dub, not all ~2,200. Visibility mirrors `videoBySlug { dubs }`: the dub and its parent video must both be non-deleted.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getDubById({
        id: String(args.id),
        query,
      }),
  }),
  videoMapperCatalog: t.field({
    type: VideoMapperCatalogConnectionRef,
    nullable: false,
    authScopes: { hasPermission: "read:video-mapper-catalog" },
    description:
      "Bounded, flat VideoDub-level catalog projection for yt-video-mapper sync. Service-readable only; callers page with `first` + `after` and receive Core-facing `coreId`/`videoVariantId` fields plus indexability state.",
    args: {
      first: t.arg.int({
        required: false,
        description:
          "Page size. Defaults to 100 and is capped at 250 for broad sync safety.",
      }),
      after: t.arg.string({
        required: false,
        description:
          "Opaque cursor from pageInfo.endCursor. Pages forward by Admin VideoDub.id.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return await ctx.services.video.listMapperCatalogVariants({
          first: args.first,
          after: args.after,
        })
      } catch (error) {
        if (error instanceof VideoLookupValidationErrorClass) {
          throw new GraphQLError(error.message, {
            extensions: { code: "BAD_USER_INPUT" },
          })
        }
        throw error
      }
    },
  }),
  videos: t.prismaField({
    type: ["Video"],
    authScopes: { public: true },
    description: "List active Videos ordered by most recent Core update.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.list({
        input: {
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
          excludeWatchRestricted: true,
        },
        query,
      }),
  }),
  watchHomeVideos: t.prismaField({
    type: ["Video"],
    nullable: false,
    authScopes: { public: true },
    description:
      "Fetch ordered, admin-backed Video records for Forge's public /watch home programming. Max 100 Core ids per call; unknown Core ids are omitted so consumers can report source gaps.",
    args: {
      coreIds: t.arg.stringList({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getWatchHomeVideos({
        coreIds: args.coreIds,
        query,
      }),
  }),
  watchCollectionFeed: t.field({
    type: WatchCollectionFeedRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "Bounded collection-parent feed for Watch homepage discovery. Ordered by stable Admin Video id; callers page with after and may exclude already-featured parent ids or slugs.",
    args: {
      first: t.arg.int({ required: false }),
      cardsPerParent: t.arg.int({ required: true }),
      locale: t.arg.string({ required: true }),
      languageSlug: t.arg.string({ required: true }),
      after: t.arg.string({ required: false }),
      excludedIds: t.arg.stringList({ required: false }),
      excludedSlugs: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return await ctx.services.video.getWatchCollectionFeed({
          first: args.first,
          cardsPerParent: args.cardsPerParent,
          locale: args.locale,
          languageSlug: args.languageSlug,
          after: args.after,
          excludedIds: args.excludedIds ?? [],
          excludedSlugs: args.excludedSlugs ?? [],
        })
      } catch (error) {
        if (error instanceof VideoLookupValidationErrorClass) {
          throw new GraphQLError(error.message, {
            extensions: { code: "BAD_USER_INPUT" },
          })
        }
        throw error
      }
    },
  }),
  watchLanguageInventory: t.field({
    type: WatchLanguageInventoryRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "Flat localized Watch /videos inventory grouped as audio collections, audio videos, and subtitle-only videos. Returns counts plus bounded card rows for regional leads and missionaries.",
    args: {
      languageSlug: t.arg.string({
        required: true,
        description:
          "Public Watch language slug, e.g. 'english' or 'spanish-latin-american'.",
      }),
      limit: t.arg.int({
        required: false,
        description:
          "Maximum rows returned per bucket. Defaults to the service cap.",
      }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.video.getWatchLanguageInventory({
        languageSlug: args.languageSlug,
        limit: args.limit,
      }),
  }),
  videosByCoreIds: t.field({
    type: [VideoForEnrichmentRef],
    authScopes: { hasPermission: "read:video-metadata" },
    description:
      "Batched coreId → dispatch-fields lookup for manager's admin-trigger enrichment endpoints (feat-125). Replaces the Strapi `videos(filters: { coreId: { in } })` call. Gated by `read:video-metadata`; manager's `ADMIN_EMBED_TRIGGER_API_KEY` bearer satisfies it via the WORKFLOW_TRIGGER allowlist. Max 100 coreIds per call (matches manager's receiver-side cap).",
    args: {
      coreIds: t.arg.stringList({ required: true }),
      targetLocale: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.video.getByCoreIds({
        coreIds: args.coreIds,
        targetLocale: args.targetLocale,
      }),
  }),
}))
