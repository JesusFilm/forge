// Pothos types for Video and its relations.
//
// Classification: Video and VideoLocale are `@classification public-shape`
// in v1 — they're Core-sourced and read-only at the GraphQL layer. Once a
// Locale is published, any authenticated principal can read it. Ownership-
// based ABAC doesn't apply because Core is authoritative; editors don't
// own individual videos, they curate localized titles/descriptions that
// land via Core sync or a future editor workflow.
//
// Naming mirrors Strapi: `video`, `videos`, `video(by: { slug: ... })`.
// `lengthInMilliseconds` is BigInt → exposed as a string to avoid JS
// Number precision loss.
//
// Per Unit 4 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"

// -----------------------------------------------------------------------------
// Enums — imported from the generated Prisma types.
// -----------------------------------------------------------------------------

const VideoLabelEnum = builder.enumType("VideoLabel", {
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

// -----------------------------------------------------------------------------
// Simple related types referenced by Video
// -----------------------------------------------------------------------------

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
    "A specific cut of a Video (theatrical, director's, extended, …). Subtitles attach here because timecodes are an edition property; dubs attach here because each dub is the audio for a specific cut.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.exposeString("name"),
    dubs: t.relation("dubs", {
      description: "Language-specific audio dubs of this edition.",
      query: { where: { deletedAt: null } },
    }),
    subtitles: t.relation("subtitles", {
      description:
        "Timed text tracks. Same-language-as-source = transcript; different language = translation; same-language-as-dub = closed captions.",
      query: { where: { deletedAt: null } },
    }),
  }),
})

/** @classification public-shape */
builder.prismaObject("MuxVideo", {
  description:
    "Mux asset metadata. Note: MuxVideo.duration is always 0 in legacy data — canonical duration lives on VideoVariant.lengthInMilliseconds.",
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

// -----------------------------------------------------------------------------
// VideoDub — formerly VideoVariant. See the rename rationale in migration
// 0006 and apps/admin/CLAUDE.md. Core sync translates "coreVariant → dub"
// at the boundary so the model name reflects the varying axis (audio dub)
// rather than Core's legacy umbrella term.
// -----------------------------------------------------------------------------

/** @classification public-shape */
builder.prismaObject("VideoDub", {
  description:
    "A language-specific audio dub of an Edition, bundled with its encoded playback (HLS/DASH/Mux). lengthInMilliseconds is BigInt — int4 truncates at 596 hours.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    slug: t.exposeString("slug", { nullable: true }),
    duration: t.exposeInt("duration", { nullable: true }),
    /**
     * BigInt exposed as a string to avoid loss of precision when >2^53.
     * Clients parse as BigInt or Number at their own risk.
     */
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

// -----------------------------------------------------------------------------
// Video + VideoLocale
// -----------------------------------------------------------------------------

/** @classification public-shape */
builder.prismaObject("VideoLocale", {
  description:
    "Per-locale title/description/snippet/imageAlt for a Video. Editors publish locales independently.",
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
builder.prismaObject("Video", {
  description:
    "A video sourced from JesusFilm Core. Read-only at the GraphQL layer in v1 — editor writes land in a later phase.",
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
        "Per-locale content rows (title, description, etc.). PUBLIC/VIEWER see PUBLISHED only; EDITOR/ADMIN see all.",
      query: (_args, ctx) =>
        ctx.user?.role === "ADMIN" || ctx.user?.role === "EDITOR"
          ? {}
          : { where: { status: "PUBLISHED" } },
    }),
    dubs: t.relation("dubs", {
      description:
        "Language-specific audio dubs + their encoded playback (formerly exposed as `variants`).",
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
  }),
})

// -----------------------------------------------------------------------------
// Root queries
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  video: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { public: true },
    description:
      "Fetch a single Video by id. PUBLIC since consumer-migration U2 (2026-05-11) — apps/web, apps/mobile, apps/tv read anonymously.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getById({
        id: String(args.id),
        user: ctx.user,
        query,
      }),
  }),
  videoBySlug: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { public: true },
    description:
      "Fetch a single Video by slug. PUBLIC since consumer-migration U2 (2026-05-11).",
    args: {
      slug: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.getBySlug({
        slug: args.slug,
        user: ctx.user,
        query,
      }),
  }),
  videos: t.prismaField({
    type: ["Video"],
    authScopes: { public: true },
    description:
      "List active Videos ordered by most recent Core update. PUBLIC since consumer-migration U2 (2026-05-11).",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.list({
        input: { limit: args.limit ?? 50, offset: args.offset ?? 0 },
        user: ctx.user,
        query,
      }),
  }),
}))
