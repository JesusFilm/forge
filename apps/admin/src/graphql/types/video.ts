// Pothos types for Video and its relations (public-shape, Core-sourced,
// read-only at the GraphQL layer). `lengthInMilliseconds` is BigInt →
// exposed as String to avoid JS Number precision loss. Per Unit 4 of
// docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import type { Prisma } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"
import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"
import type { VideoForEnrichment } from "@/services/video.service"

// Principal-aware relation filters — extracted so the per-principal /
// per-locale shape is unit-testable. EDITOR/ADMIN see everything;
// anonymous and VIEWER callers see PUBLISHED-only (mirroring
// `Experience.locales` per
// `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`).
// For `parents`/`children`, "PUBLISHED" means the related Video itself
// has at least one PUBLISHED locale AND is not soft-deleted.

export function videoLocalesFilter(
  args: { locale?: string | null },
  user: Principal | null,
): { where: Prisma.VideoLocaleWhereInput } | Record<string, never> {
  // Treat empty string the same as missing — caller intent is "no locale
  // filter," not "narrow to the zero-length locale code" (which would match
  // zero rows).
  const locale =
    typeof args.locale === "string" && args.locale.length > 0
      ? args.locale
      : null
  const localeFilter = locale != null ? { locale } : {}
  if (isEditorOrAdmin(user)) {
    return locale != null ? { where: localeFilter } : {}
  }
  return {
    where: { status: "PUBLISHED" as const, ...localeFilter },
  }
}

export function videoParentsFilter(
  user: Principal | null,
): { where: Prisma.VideoRelationWhereInput } | Record<string, never> {
  if (isEditorOrAdmin(user)) return {}
  return {
    where: {
      parent: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" as const } },
      },
    },
  }
}

export function videoChildrenFilter(
  user: Principal | null,
): { where: Prisma.VideoRelationWhereInput } | Record<string, never> {
  if (isEditorOrAdmin(user)) return {}
  return {
    where: {
      child: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" as const } },
      },
    },
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
builder.prismaObject("BibleCitation", {
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
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoImage", {
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
    blurhash: t.exposeString("blurhash", { nullable: true }),
    kind: t.exposeString("kind", { nullable: true }),
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
    downloads: t.relation("downloads", {
      query: { where: { deletedAt: null } },
    }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoLocale", {
  description: "Per-locale title/description/snippet/imageAlt for a Video.",
  fields: (t) => ({
    id: t.exposeID("id"),
    locale: t.exposeString("locale"),
    title: t.exposeString("title", { nullable: true }),
    description: t.exposeString("description", { nullable: true }),
    snippet: t.exposeString("snippet", { nullable: true }),
    imageAlt: t.exposeString("imageAlt", { nullable: true }),
    status: t.expose("status", { type: LocaleStatusEnum }),
    publishedAt: t.string({
      nullable: true,
      resolve: (row) => row.publishedAt?.toISOString() ?? null,
    }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoStudyQuestion", {
  description: "A per-locale Core-sourced study question attached to a video.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId", { nullable: true }),
    locale: t.exposeString("locale", { nullable: true }),
    text: t.exposeString("text"),
    primary: t.exposeBoolean("primary"),
    order: t.exposeInt("order", { nullable: true }),
    language: t.relation("language", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoRelation", {
  description:
    "Self-referential parent/child join between Videos (e.g. series→episode). Exposes the related parent/child Video plus its ordering position.",
  fields: (t) => ({
    id: t.exposeID("id"),
    order: t.exposeInt("order", { nullable: true }),
    parent: t.relation("parent"),
    child: t.relation("child"),
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
    aiMetadata: t.exposeBoolean("aiMetadata"),
    primaryLanguage: t.relation("primaryLanguage", { nullable: true }),
    origin: t.relation("origin", { nullable: true }),
    locales: t.relation("locales", {
      description:
        "PUBLIC/VIEWER see PUBLISHED only; EDITOR/ADMIN see all. Pass `locale` to narrow the result to a single BCP-47 locale (web's WatchVideo fragment uses this to avoid overfetching every locale).",
      args: {
        locale: t.arg.string({ required: false }),
      },
      query: (args, ctx) => videoLocalesFilter(args, ctx.user),
    }),
    dubs: t.relation("dubs", {
      query: { where: { deletedAt: null } },
    }),
    images: t.relation("images", {
      query: { where: { deletedAt: null } },
    }),
    studyQuestions: t.relation("studyQuestions", {
      query: { where: { deletedAt: null } },
    }),
    bibleCitations: t.relation("bibleCitations", {
      query: { where: { deletedAt: null } },
    }),
    parents: t.relation("parents", {
      description:
        "Parent Video-Video relations: rows where this Video appears on the CHILD side of the VideoRelation join. Traverse `parent { … }` to read the foreign Video. PUBLIC/VIEWER see only relations whose parent has a PUBLISHED locale and is not soft-deleted; EDITOR/ADMIN see all.",
      query: (_args, ctx) => videoParentsFilter(ctx.user),
    }),
    children: t.relation("children", {
      description:
        "Child Video-Video relations: rows where this Video appears on the PARENT side of the VideoRelation join. Traverse `child { … }` to read the foreign Video. PUBLIC/VIEWER see only relations whose child has a PUBLISHED locale and is not soft-deleted; EDITOR/ADMIN see all.",
      query: (_args, ctx) => videoChildrenFilter(ctx.user),
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
    "Dispatch-fields projection for manager's admin-trigger enrichment lookup. Each field is nullable; null mux/subtitle signals manager to return validation_failed for that item.",
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
    primaryLanguageBcp47: t.exposeString("primaryLanguageBcp47", {
      nullable: true,
      description:
        "BCP-47 tag of the video's primary language; null when unattested.",
    }),
    muxAssetId: t.exposeString("muxAssetId", {
      nullable: true,
      description:
        "Mux assetId of the primary-language dub; null when no matching variant exists.",
    }),
    subtitleUrl: t.exposeString("subtitleUrl", {
      nullable: true,
      description:
        "VTT URL of the best primary-language subtitle (primary + non-AI preferred); null when no candidate exists.",
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
        input: { limit: args.limit ?? 50, offset: args.offset ?? 0 },
        query,
      }),
  }),
  videosByCoreIds: t.field({
    type: [VideoForEnrichmentRef],
    authScopes: { hasPermission: "read:video-metadata" },
    description:
      "Batched coreId → dispatch-fields lookup for manager's admin-trigger enrichment endpoints (feat-125). Replaces the Strapi `videos(filters: { coreId: { in } })` call. Gated by `read:video-metadata`; manager's `ADMIN_EMBED_TRIGGER_API_KEY` bearer satisfies it via the WORKFLOW_TRIGGER allowlist. Max 100 coreIds per call (matches manager's receiver-side cap).",
    args: {
      coreIds: t.arg.stringList({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.video.getByCoreIds({ coreIds: args.coreIds }),
  }),
}))
