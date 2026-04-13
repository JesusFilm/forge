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

const LocaleStatusEnum = builder.enumType("LocaleStatus", {
  values: {
    DRAFT: { value: "DRAFT" },
    PUBLISHED: { value: "PUBLISHED" },
    ARCHIVED: { value: "ARCHIVED" },
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
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoEdition", {
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.exposeString("name"),
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
builder.prismaObject("VideoImage", {
  fields: (t) => ({
    id: t.exposeID("id"),
    url: t.exposeString("url", { nullable: true }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    blurhash: t.exposeString("blurhash", { nullable: true }),
    kind: t.exposeString("kind", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("VideoSubtitle", {
  fields: (t) => ({
    id: t.exposeID("id"),
    vttSrc: t.exposeString("vttSrc", { nullable: true }),
    srtSrc: t.exposeString("srtSrc", { nullable: true }),
    aiGenerated: t.exposeBoolean("aiGenerated"),
    /**
     * Language id (FK to Language.id). The Prisma model doesn't yet carry a
     * full relation field — added when subtitle-filtered queries need it.
     */
    languageId: t.exposeID("languageId", { nullable: true }),
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
    aiGenerated: t.exposeBoolean("aiGenerated"),
    language: t.relation("language", { nullable: true }),
    videoEdition: t.relation("videoEdition", { nullable: true }),
    muxVideo: t.relation("muxVideo", { nullable: true }),
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
    locked: t.exposeBoolean("locked"),
    noIndex: t.exposeBoolean("noIndex"),
    aiMetadata: t.exposeBoolean("aiMetadata"),
    primaryLanguage: t.relation("primaryLanguage", { nullable: true }),
    origin: t.relation("origin", { nullable: true }),
    locales: t.relation("locales", {
      description: "Per-locale content rows (title, description, etc.).",
    }),
    dubs: t.relation("dubs", {
      description:
        "Language-specific audio dubs + their encoded playback (formerly exposed as `variants`).",
    }),
    subtitles: t.relation("subtitles"),
    images: t.relation("images"),
  }),
})

// -----------------------------------------------------------------------------
// Root queries
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  video: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { loggedIn: true },
    description:
      "Fetch a single Video by id. Unit 6 widens to PUBLIC for appropriate reads.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.video.findFirst({
        ...query,
        where: { id: String(args.id), deletedAt: null },
      }),
  }),
  videoBySlug: t.prismaField({
    type: "Video",
    nullable: true,
    authScopes: { loggedIn: true },
    args: {
      slug: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.video.findFirst({
        ...query,
        where: { slug: args.slug, deletedAt: null },
      }),
  }),
  videos: t.prismaField({
    type: ["Video"],
    authScopes: { loggedIn: true },
    description: "List active Videos ordered by most recent Core update.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.video.findMany({
        ...query,
        where: { deletedAt: null },
        orderBy: [{ coreUpdatedAt: "desc" }, { createdAt: "desc" }],
        take: Math.min(args.limit ?? 50, 200),
        skip: args.offset ?? 0,
      }),
  }),
}))
