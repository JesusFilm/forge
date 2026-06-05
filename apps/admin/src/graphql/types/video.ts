// Pothos types for Video and its relations (public-shape, Core-sourced,
// read-only at the GraphQL layer). `lengthInMilliseconds` is BigInt →
// exposed as String to avoid JS Number precision loss. Per Unit 4 of
// docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import type { Prisma } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { isEditorOrAdmin } from "@/auth/principal"
import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"
import type {
  ChildDubLanguageRow,
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

export function videoParentsFilter(
  user: Principal | null,
): { where: Prisma.VideoRelationWhereInput } | Record<string, never> {
  if (isEditorOrAdmin(user)) return {}
  return {
    where: {
      parent: {
        deletedAt: null,
        locales: { some: { status: "PUBLISHED" as const, deletedAt: null } },
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
        locales: { some: { status: "PUBLISHED" as const, deletedAt: null } },
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

const VideoListCategoryEnum = builder.enumType("VideoListCategory", {
  description: "Category filter for the public video list.",
  values: {
    ALL: { value: "all" },
    COLLECTIONS: { value: "collections" },
    FEATURES: { value: "features" },
    SHORT_FILMS: { value: "shortFilms" },
    SERIES: { value: "series" },
  } as const,
})

const VideoListSortEnum = builder.enumType("VideoListSort", {
  description: "Sort order for the public video list.",
  values: {
    RECENT: { value: "recent" },
    OLDEST: { value: "oldest" },
    CREATED: { value: "created" },
    CREATED_OLDEST: { value: "createdOldest" },
  } as const,
})

function normalizeLanguageFilter(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? ""
}

function containsLanguageFilter(value: string) {
  return { contains: value, mode: "insensitive" as const }
}

function videoDubLanguageFilter(
  rawLanguage: string | null | undefined,
): Prisma.VideoDubWhereInput | null {
  const language = normalizeLanguageFilter(rawLanguage)
  if (!language) return null
  const text = containsLanguageFilter(language)

  return {
    language: {
      is: {
        deletedAt: null,
        OR: [
          { id: text },
          { coreId: text },
          { bcp47: text },
          { iso3: text },
          { slug: text },
        ],
      },
    },
  } satisfies Prisma.VideoDubWhereInput
}

function videoDubsRelationQuery(args: {
  language?: string | null
  limit?: number | null
  playableOnly?: boolean | null
}) {
  const filters: Prisma.VideoDubWhereInput[] = [{ deletedAt: null }]
  const languageFilter = videoDubLanguageFilter(args.language)
  if (languageFilter) filters.push(languageFilter)
  if (args.playableOnly === true) {
    filters.push({
      published: true,
      AND: [{ hls: { not: null } }, { hls: { not: "" } }],
    })
  }

  const limit =
    args.limit == null ? null : Math.min(Math.max(args.limit, 0), 50)
  return {
    where:
      filters.length === 1
        ? filters[0]
        : ({ AND: filters } satisfies Prisma.VideoDubWhereInput),
    ...(limit != null ? { take: limit } : {}),
    ...(limit != null || languageFilter || args.playableOnly === true
      ? {
          orderBy: [
            { duration: "desc" as const },
            { createdAt: "asc" as const },
            { id: "asc" as const },
          ],
        }
      : {}),
  }
}

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
      args: {
        language: t.arg.string({
          required: false,
          description:
            "Language identifier matched against dub language id, coreId, slug, bcp47, or iso3.",
        }),
        limit: t.arg.int({
          required: false,
          description:
            "Optional upper bound for callers that need one selected playable dub rather than every dub on the video.",
        }),
        playableOnly: t.arg.boolean({
          required: false,
          defaultValue: false,
          description:
            "When true, returns only published dubs with a non-empty HLS URL.",
        }),
      },
      query: (args) => videoDubsRelationQuery(args),
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
builder.prismaObject("VideoStudyQuestion", {
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
    aiMetadata: t.exposeBoolean("aiMetadata"),
    primaryLanguage: t.relation("primaryLanguage", { nullable: true }),
    origin: t.relation("origin", { nullable: true }),
    durationSeconds: t.int({
      nullable: true,
      description:
        "Primary playable VideoDub duration in seconds, or null when the video has no playable dub (e.g. a SERIES/COLLECTION whose runtime lives on its children). Mirrors HybridSearchResult.durationSeconds — picks the primary-language playable dub, else the longest. Lets watch/series carousels render a per-chapter runtime pill via `children { child { durationSeconds } }` without projecting every child's full dub list. Batched per request through a DataLoader.",
      resolve: (video, _args, ctx) =>
        ctx.loaders.videoPrimaryDubDurationById.load(video.id),
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
    locales: t.relation("locales", {
      description:
        "PUBLIC/VIEWER see PUBLISHED only; EDITOR/ADMIN see all. Pass `locale` to narrow the result to a single BCP-47 locale (web's WatchVideo fragment uses this to avoid overfetching every locale).",
      args: {
        locale: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      query: (args, ctx) => videoLocalesFilter(args, ctx.user),
    }),
    dubs: t.relation("dubs", {
      args: {
        language: t.arg.string({
          required: false,
          description:
            "Language identifier matched against dub language id, coreId, slug, bcp47, or iso3.",
        }),
        limit: t.arg.int({
          required: false,
          description:
            "Optional upper bound for callers that need one selected playable dub rather than every dub on the video.",
        }),
        playableOnly: t.arg.boolean({
          required: false,
          defaultValue: false,
          description:
            "When true, returns only published dubs with a non-empty HLS URL.",
        }),
      },
      query: (args) => videoDubsRelationQuery(args),
    }),
    images: t.relation("images", {
      query: { where: { deletedAt: null } },
    }),
    studyQuestions: t.relation("studyQuestions", {
      args: {
        locale: t.arg.string({ required: false }),
        languageSlug: t.arg.string({ required: false }),
      },
      query: (args) => videoStudyQuestionsFilter(args),
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
  videos: t.prismaField({
    type: ["Video"],
    authScopes: { public: true },
    description:
      "List active Videos ordered by most recent Core update. Optional filters mirror VideoService.list and are public so consumer apps can assemble admin-backed watch surfaces without privileged endpoints.",
    args: {
      category: t.arg({ type: VideoListCategoryEnum, required: false }),
      collection: t.arg.string({
        required: false,
        description:
          "Collection identifier matched against parent video id, coreId, or slug.",
      }),
      language: t.arg.string({
        required: false,
        description:
          "Language identifier matched against playable dub language id, coreId, slug, bcp47, or name.",
      }),
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
      search: t.arg.string({ required: false }),
      sort: t.arg({ type: VideoListSortEnum, required: false }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.video.list({
        input: {
          ...(args.category != null ? { category: args.category } : {}),
          ...(args.collection != null ? { collection: args.collection } : {}),
          ...(args.language != null ? { language: args.language } : {}),
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
          ...(args.search != null ? { search: args.search } : {}),
          ...(args.sort != null ? { sort: args.sort } : {}),
        },
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
      targetLocale: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.video.getByCoreIds({
        coreIds: args.coreIds,
        targetLocale: args.targetLocale,
      }),
  }),
}))
