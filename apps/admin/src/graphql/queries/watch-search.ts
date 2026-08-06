import { builder } from "@/graphql/builder"
import type {
  WatchSearchAction,
  WatchSearchAvailability,
  WatchSearchEvidence,
  WatchSearchFallback,
  WatchSearchInput as WatchSearchServiceInput,
  WatchSearchLaneStatus,
  WatchSearchLanguageInterpretation,
  WatchSearchResponse,
  WatchSearchResult,
} from "@/services/watch-search.service"
import { recordWatchSearchTraceSafely } from "@/services/search-trace.service"
import { TypesenseWatchSearchUnavailableError } from "@/services/typesense-watch-search.service"
import type { WatchSearchSuggestionInput } from "@/services/typesense-watch-search-suggestions"

const WatchSearchResultTypeEnum = builder.enumType("WatchSearchResultType", {
  values: {
    VIDEO: { value: "video" },
    EXPERIENCE: { value: "experience" },
  } as const,
})

const WatchSearchModeEnum = builder.enumType("WatchSearchMode", {
  values: {
    DEFAULT: { value: "default" },
    MODERN: { value: "modern" },
  } as const,
})

const WatchSearchActionKindEnum = builder.enumType("WatchSearchActionKind", {
  values: {
    WATCH: { value: "watch" },
    OPEN_EXPERIENCE: { value: "open_experience" },
  } as const,
})

const WatchSearchAvailabilityKindEnum = builder.enumType(
  "WatchSearchAvailabilityKind",
  {
    values: {
      TARGET_AUDIO: { value: "target_audio" },
      TARGET_SUBTITLE: { value: "target_subtitle" },
      RELATED_LANGUAGE: { value: "related_language" },
      UNAVAILABLE: { value: "unavailable" },
    } as const,
  },
)

const WatchSearchEvidenceKindEnum = builder.enumType(
  "WatchSearchEvidenceKind",
  {
    values: {
      EXACT_TITLE: { value: "exact_title" },
      LANGUAGE_AVAILABILITY: { value: "language_availability" },
      TRANSCRIPT_SEMANTIC: { value: "transcript_semantic" },
      METADATA: { value: "metadata" },
    } as const,
  },
)

const WatchSearchFallbackKindEnum = builder.enumType(
  "WatchSearchFallbackKind",
  {
    values: {
      NONE: { value: "none" },
      SUBTITLE: { value: "subtitle" },
      RELATED_LANGUAGE: { value: "related_language" },
      UNAVAILABLE: { value: "unavailable" },
    } as const,
  },
)

const WatchSearchLaneStatusRef = builder
  .objectRef<WatchSearchLaneStatus>("WatchSearchLaneStatus")
  .implement({
    fields: (t) => ({
      lane: t.exposeString("lane"),
      status: t.exposeString("status"),
      elapsedMs: t.exposeFloat("elapsedMs"),
      resultCount: t.exposeInt("resultCount"),
      reason: t.exposeString("reason", { nullable: true }),
      detail: t.exposeString("detail", { nullable: true }),
    }),
  })

const WatchSearchInput = builder.inputType("WatchSearchInput", {
  fields: (t) => ({
    query: t.string({ required: true }),
    mode: t.field({ type: WatchSearchModeEnum, required: false }),
    clientRequestId: t.string({ required: false }),
    targetLanguageSlug: t.string({ required: false }),
    queryLanguageSlug: t.string({ required: false }),
    queryNamedLanguageSlug: t.string({ required: false }),
    displayLanguageSlug: t.string({ required: false }),
    routeLanguageSlug: t.string({ required: false }),
    currentWatchLanguageSlug: t.string({ required: false }),
    acceptLanguage: t.string({ required: false }),
    limit: t.int({ required: false }),
    offset: t.int({ required: false }),
    resultTypes: t.field({
      type: [WatchSearchResultTypeEnum],
      required: false,
    }),
  }),
})

const WatchSearchSuggestionsInput = builder.inputType(
  "WatchSearchSuggestionsInput",
  {
    fields: (t) => ({
      query: t.string({ required: true }),
      languageSlug: t.string({ required: true }),
    }),
  },
)

const WatchSearchLanguageInterpretationRef = builder
  .objectRef<WatchSearchLanguageInterpretation>(
    "WatchSearchLanguageInterpretation",
  )
  .implement({
    fields: (t) => ({
      queryLanguageSlug: t.exposeString("queryLanguageSlug", {
        nullable: true,
      }),
      queryNamedLanguageSlug: t.exposeString("queryNamedLanguageSlug", {
        nullable: true,
      }),
      targetLanguageSlug: t.exposeString("targetLanguageSlug", {
        nullable: false,
      }),
      targetLanguageSource: t.exposeString("targetLanguageSource", {
        nullable: false,
      }),
      displayLanguageSlug: t.exposeString("displayLanguageSlug", {
        nullable: true,
      }),
      routeLanguageSlug: t.exposeString("routeLanguageSlug", {
        nullable: true,
      }),
      currentWatchLanguageSlug: t.exposeString("currentWatchLanguageSlug", {
        nullable: true,
      }),
      acceptLanguage: t.exposeString("acceptLanguage", { nullable: true }),
      acceptLanguageSlug: t.exposeString("acceptLanguageSlug", {
        nullable: true,
      }),
    }),
  })

const WatchSearchAvailabilityRef = builder
  .objectRef<WatchSearchAvailability>("WatchSearchAvailability")
  .implement({
    fields: (t) => ({
      kind: t.field({
        type: WatchSearchAvailabilityKindEnum,
        resolve: (row) => row.kind,
      }),
      languageSlug: t.exposeString("languageSlug", { nullable: true }),
      languageEnglishName: t.exposeString("languageEnglishName", {
        nullable: true,
      }),
      audio: t.exposeBoolean("audio"),
      subtitles: t.exposeBoolean("subtitles"),
    }),
  })

const WatchSearchEvidenceRef = builder
  .objectRef<WatchSearchEvidence>("WatchSearchEvidence")
  .implement({
    fields: (t) => ({
      kind: t.field({
        type: WatchSearchEvidenceKindEnum,
        resolve: (row) => row.kind,
      }),
      languageSlug: t.exposeString("languageSlug", { nullable: true }),
      label: t.exposeString("label", { nullable: true }),
    }),
  })

const WatchSearchActionRef = builder
  .objectRef<WatchSearchAction>("WatchSearchAction")
  .implement({
    fields: (t) => ({
      kind: t.field({
        type: WatchSearchActionKindEnum,
        resolve: (row) => row.kind,
      }),
      hrefLanguageSlug: t.exposeString("hrefLanguageSlug", { nullable: true }),
    }),
  })

const WatchSearchFallbackRef = builder
  .objectRef<WatchSearchFallback>("WatchSearchFallback")
  .implement({
    fields: (t) => ({
      kind: t.field({
        type: WatchSearchFallbackKindEnum,
        resolve: (row) => row.kind,
      }),
      message: t.exposeString("message", { nullable: true }),
    }),
  })

const WatchSearchResultRef = builder
  .objectRef<WatchSearchResult>("WatchSearchResult")
  .implement({
    fields: (t) => ({
      type: t.field({
        type: WatchSearchResultTypeEnum,
        resolve: (row) => row.type,
      }),
      id: t.exposeID("id"),
      slug: t.exposeString("slug"),
      title: t.exposeString("title"),
      description: t.exposeString("description", { nullable: true }),
      snippet: t.exposeString("snippet", { nullable: true }),
      imageUrl: t.exposeString("imageUrl", { nullable: true }),
      imageBlurDataUrl: t.exposeString("imageBlurDataUrl", { nullable: true }),
      muxThumbnailBlurDataUrl: t.exposeString("muxThumbnailBlurDataUrl", {
        nullable: true,
      }),
      playbackId: t.exposeString("playbackId", { nullable: true }),
      startSeconds: t.exposeInt("startSeconds", { nullable: true }),
      score: t.exposeFloat("score"),
      label: t.exposeString("label", { nullable: true }),
      durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
      childCount: t.exposeInt("childCount", { nullable: true }),
      languageSlug: t.exposeString("languageSlug", { nullable: true }),
      languageEnglishName: t.exposeString("languageEnglishName", {
        nullable: true,
      }),
      availability: t.field({
        type: WatchSearchAvailabilityRef,
        resolve: (row) => row.availability,
      }),
      evidence: t.field({
        type: WatchSearchEvidenceRef,
        resolve: (row) => row.evidence,
      }),
      action: t.field({
        type: WatchSearchActionRef,
        resolve: (row) => row.action,
      }),
      fallback: t.field({
        type: WatchSearchFallbackRef,
        resolve: (row) => row.fallback,
      }),
    }),
  })

const WatchSearchResponseRef = builder
  .objectRef<WatchSearchResponse>("WatchSearchResponse")
  .implement({
    fields: (t) => ({
      query: t.exposeString("query"),
      results: t.field({
        type: [WatchSearchResultRef],
        resolve: (row) => row.results,
      }),
      hasMore: t.exposeBoolean("hasMore"),
      nextOffset: t.exposeInt("nextOffset"),
      searchMode: t.exposeString("searchMode"),
      requestId: t.exposeString("requestId"),
      degraded: t.exposeBoolean("degraded"),
      latencyMs: t.exposeFloat("latencyMs"),
      laneStatuses: t.field({
        type: [WatchSearchLaneStatusRef],
        resolve: (row) => row.laneStatuses,
      }),
      languageInterpretation: t.field({
        type: WatchSearchLanguageInterpretationRef,
        resolve: (row) => row.languageInterpretation,
      }),
    }),
  })

builder.queryFields((t) => ({
  watchSearchSuggestions: t.field({
    type: ["String"],
    authScopes: { public: true },
    description:
      "Return bounded language-aware Watch title completions without running full search.",
    args: {
      input: t.arg({ type: WatchSearchSuggestionsInput, required: true }),
    },
    resolve: (_root, args, ctx) => {
      const service = ctx.services.typesenseWatchSearchSuggestions
      if (!service) return []
      return service.suggest(args.input as WatchSearchSuggestionInput)
    },
  }),
  watchSearch: t.field({
    type: WatchSearchResponseRef,
    authScopes: { public: true },
    description:
      "Search Watch content using separated query, target language, display language, evidence, and availability signals.",
    args: {
      input: t.arg({ type: WatchSearchInput, required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const input = args.input as WatchSearchServiceInput
      const startedAt = new Date()
      const service =
        input.mode === "modern"
          ? ctx.services.typesenseWatchSearch
          : ctx.services.watchSearch
      if (!service) throw new TypesenseWatchSearchUnavailableError()
      const response = await service.search(input)
      await recordWatchSearchTraceSafely(
        {
          input,
          response,
          startedAt,
          completedAt: new Date(),
        },
        ctx.prisma,
      ).catch(() => {})
      return response
    },
  }),
}))
