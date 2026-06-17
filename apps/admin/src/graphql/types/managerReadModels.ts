import { builder } from "@/graphql/builder"

type ManagerLanguageGeo = Awaited<
  ReturnType<
    import("@/services/manager-read-model.service").ManagerReadModelService["getLanguageGeo"]
  >
>
type ManagerVideoCoverage = Awaited<
  ReturnType<
    import("@/services/manager-read-model.service").ManagerReadModelService["getVideoCoverage"]
  >
>[number]
type ManagerVideoForEnrichment = Awaited<
  ReturnType<
    import("@/services/manager-read-model.service").ManagerReadModelService["getVideosForEnrichment"]
  >
>[number]
type ManagerCoverageSnapshot = Awaited<
  ReturnType<
    import("@/services/manager-read-model.service").ManagerReadModelService["getCoverageSnapshots"]
  >
>[number]

const ManagerContinentRef = builder
  .objectRef<ManagerLanguageGeo["continents"][number]>("ManagerContinent")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      name: t.exposeString("name"),
    }),
  })

const ManagerCountryRef = builder
  .objectRef<ManagerLanguageGeo["countries"][number]>("ManagerCountry")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      name: t.exposeString("name"),
      continentId: t.exposeString("continentId"),
    }),
  })

const ManagerLanguageRef = builder
  .objectRef<ManagerLanguageGeo["languages"][number]>("ManagerLanguage")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      coreId: t.exposeString("coreId", { nullable: true }),
      bcp47: t.exposeString("bcp47", { nullable: true }),
      iso3: t.exposeString("iso3", { nullable: true }),
      englishLabel: t.exposeString("englishLabel"),
      nativeLabel: t.exposeString("nativeLabel"),
      countryIds: t.field({
        type: ["String"],
        resolve: (row) => row.countryIds,
      }),
      continentIds: t.field({
        type: ["String"],
        resolve: (row) => row.continentIds,
      }),
      countrySpeakers: t.field({
        type: "JSON",
        resolve: (row) => row.countrySpeakers,
      }),
    }),
  })

const ManagerEnrichmentLanguageRef = builder
  .objectRef<
    NonNullable<ManagerVideoForEnrichment["primaryLanguage"]>
  >("ManagerEnrichmentLanguage")
  .implement({
    fields: (t) => ({
      coreId: t.exposeString("coreId", { nullable: true }),
      bcp47: t.exposeString("bcp47", { nullable: true }),
      iso3: t.exposeString("iso3", { nullable: true }),
    }),
  })

const ManagerEnrichmentMuxVideoRef = builder
  .objectRef<
    NonNullable<ManagerVideoForEnrichment["variants"][number]["muxVideo"]>
  >("ManagerEnrichmentMuxVideo")
  .implement({
    fields: (t) => ({
      assetId: t.exposeString("assetId", { nullable: true }),
      playbackId: t.exposeString("playbackId", { nullable: true }),
    }),
  })

const ManagerEnrichmentDownloadRef = builder
  .objectRef<
    ManagerVideoForEnrichment["variants"][number]["downloads"][number]
  >("ManagerEnrichmentDownload")
  .implement({
    fields: (t) => ({
      url: t.exposeString("url", { nullable: true }),
    }),
  })

const ManagerEnrichmentVariantRef = builder
  .objectRef<
    ManagerVideoForEnrichment["variants"][number]
  >("ManagerEnrichmentVariant")
  .implement({
    fields: (t) => ({
      language: t.field({
        type: ManagerEnrichmentLanguageRef,
        nullable: true,
        resolve: (row) => row.language,
      }),
      muxVideo: t.field({
        type: ManagerEnrichmentMuxVideoRef,
        nullable: true,
        resolve: (row) => row.muxVideo,
      }),
      downloads: t.field({
        type: [ManagerEnrichmentDownloadRef],
        resolve: (row) => row.downloads,
      }),
    }),
  })

const ManagerVideoForEnrichmentRef = builder
  .objectRef<ManagerVideoForEnrichment>("ManagerVideoForEnrichment")
  .implement({
    fields: (t) => ({
      documentId: t.exposeID("documentId"),
      coreId: t.exposeString("coreId", { nullable: true }),
      title: t.exposeString("title", { nullable: true }),
      label: t.exposeString("label", { nullable: true }),
      primaryLanguage: t.field({
        type: ManagerEnrichmentLanguageRef,
        nullable: true,
        resolve: (row) => row.primaryLanguage,
      }),
      variants: t.field({
        type: [ManagerEnrichmentVariantRef],
        resolve: (row) => row.variants,
      }),
    }),
  })

const ManagerLanguageGeoRef = builder
  .objectRef<ManagerLanguageGeo>("ManagerLanguageGeo")
  .implement({
    fields: (t) => ({
      continents: t.field({
        type: [ManagerContinentRef],
        resolve: (row) => row.continents,
      }),
      countries: t.field({
        type: [ManagerCountryRef],
        resolve: (row) => row.countries,
      }),
      languages: t.field({
        type: [ManagerLanguageRef],
        resolve: (row) => row.languages,
      }),
    }),
  })

const ManagerCoverageCountsRef = builder
  .objectRef<ManagerVideoCoverage["coverage"]["audio"]>("ManagerCoverageCounts")
  .implement({
    fields: (t) => ({
      human: t.exposeInt("human"),
      ai: t.exposeInt("ai"),
    }),
  })

const ManagerVideoCoverageBreakdownRef = builder
  .objectRef<ManagerVideoCoverage["coverage"]>("ManagerVideoCoverageBreakdown")
  .implement({
    fields: (t) => ({
      subtitles: t.field({
        type: ManagerCoverageCountsRef,
        resolve: (row) => row.subtitles,
      }),
      audio: t.field({
        type: ManagerCoverageCountsRef,
        resolve: (row) => row.audio,
      }),
    }),
  })

const ManagerVideoCoverageParentRelationRef = builder
  .objectRef<
    ManagerVideoCoverage["parentRelations"][number]
  >("ManagerVideoCoverageParentRelation")
  .implement({
    fields: (t) => ({
      parentDocumentId: t.exposeString("parentDocumentId"),
      order: t.exposeInt("order", { nullable: true }),
    }),
  })

const ManagerVideoCoverageRef = builder
  .objectRef<ManagerVideoCoverage>("ManagerVideoCoverage")
  .implement({
    fields: (t) => ({
      documentId: t.exposeID("documentId"),
      coreId: t.exposeString("coreId", { nullable: true }),
      title: t.exposeString("title", { nullable: true }),
      label: t.exposeString("label", { nullable: true }),
      slug: t.exposeString("slug", { nullable: true }),
      aiMetadata: t.exposeBoolean("aiMetadata", { nullable: true }),
      imageUrl: t.exposeString("imageUrl", { nullable: true }),
      parentDocumentIds: t.field({
        type: ["String"],
        resolve: (row) => row.parentDocumentIds,
      }),
      parentRelations: t.field({
        type: [ManagerVideoCoverageParentRelationRef],
        resolve: (row) => row.parentRelations,
      }),
      coverage: t.field({
        type: ManagerVideoCoverageBreakdownRef,
        resolve: (row) => row.coverage,
      }),
    }),
  })

const ManagerCoverageSnapshotRef = builder
  .objectRef<ManagerCoverageSnapshot>("ManagerCoverageSnapshot")
  .implement({
    fields: (t) => ({
      documentId: t.exposeID("documentId"),
      date: t.exposeString("date"),
      computedAt: t.exposeString("computedAt"),
      totalVideos: t.exposeInt("totalVideos"),
      videosWithAiMetadata: t.exposeInt("videosWithAiMetadata"),
      videosWithHumanMetadata: t.exposeInt("videosWithHumanMetadata"),
      subtitlesHumanTotal: t.exposeInt("subtitlesHumanTotal"),
      subtitlesAiTotal: t.exposeInt("subtitlesAiTotal"),
      audioHumanTotal: t.exposeInt("audioHumanTotal"),
      audioAiTotal: t.exposeInt("audioAiTotal"),
      languageCoverage: t.field({
        type: "JSON",
        resolve: (row) => row.languageCoverage,
      }),
    }),
  })

builder.queryFields((t) => ({
  managerLanguageGeo: t.field({
    type: ManagerLanguageGeoRef,
    authScopes: { hasPermission: "read:manager-read-models" },
    resolve: (_root, _args, ctx) =>
      ctx.services.managerReadModel.getLanguageGeo({ user: ctx.user }),
  }),
  managerVideoCoverage: t.field({
    type: [ManagerVideoCoverageRef],
    authScopes: { hasPermission: "read:manager-read-models" },
    args: {
      languageIds: t.arg.stringList({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerReadModel.getVideoCoverage({
        user: ctx.user,
        languageIds: args.languageIds?.filter(Boolean) ?? [],
      }),
  }),
  managerVideosForEnrichment: t.field({
    type: [ManagerVideoForEnrichmentRef],
    authScopes: { hasPermission: "read:manager-read-models" },
    args: {
      ids: t.arg.stringList({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerReadModel.getVideosForEnrichment({
        user: ctx.user,
        ids: args.ids.filter((id): id is string => Boolean(id)),
      }),
  }),
  managerCoverageSnapshots: t.field({
    type: [ManagerCoverageSnapshotRef],
    authScopes: { hasPermission: "read:manager-read-models" },
    args: {
      latest: t.arg.boolean({ required: false }),
      startDate: t.arg.string({ required: false }),
      endDate: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerReadModel.getCoverageSnapshots({
        user: ctx.user,
        latest: args.latest ?? false,
        startDate: args.startDate,
        endDate: args.endDate,
      }),
  }),
}))
