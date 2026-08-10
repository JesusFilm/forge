// Unit 4 — schema structural tests for real content types. No live DB.
//
// Assertions use the schema's string accessors instead of `instanceof` so
// they survive vitest's occasional double-instance of the `graphql` module
// in transitive deps.
//
// What this proves at static assembly time:
//   - Yoga + Pothos + Prisma plugin + scope-auth still compile and assemble
//     after the switch from the Unit 3 Ping spike to Experience + Video
//   - Root queries for experience/video/reference data exist
//   - Experience.locales relation is present (Unit 6 audits the ABAC wiring)
//   - Experience does NOT expose an `embedding` field (technical control
//     per R20; Unit 9 adds the resolver-surface sweep)
//   - Video + ExperienceLocale scalar/enum fields expose the expected shape
//
// DB-DEPENDENT assertions (nested-relation SQL count, ABAC parity test) live
// in later units once services are in place.

import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

type FieldsHolder = { getFields(): Record<string, unknown> }

function fieldsOf(typeName: string): Record<string, unknown> {
  const t = schema.getType(typeName)
  expect(t, `type ${typeName} should exist on the schema`).toBeTruthy()
  return (t as unknown as FieldsHolder).getFields()
}

describe("GraphQL schema — Unit 4 content types", () => {
  it("Query root exposes the expected entry points", () => {
    const query = schema.getQueryType()
    expect(query).toBeTruthy()
    const fields = query!.getFields()
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        // Reference data
        "languages",
        "countries",
        "keywords",
        // Media assets
        "mediaAsset",
        "mediaAssets",
        "mediaAssetUsage",
        "mediaFolders",
        // Video
        "video",
        "videoBySlug",
        "videos",
        "watchHomeVideos",
        "watchLanguageInventory",
        "watchSearch",
        "videosByCoreIds",
        // Experience
        "experience",
        "experiences",
        "experienceBySlug",
        "watchSetting",
        // Manager backend contracts
        "managerViewer",
        "managerLanguageGeo",
        "managerVideoCoverage",
        "managerVideosForEnrichment",
        "managerCoverageSnapshots",
        "managerJobs",
        "managerJob",
      ]),
    )
  })

  it("extends the stable Watch locale contract with search/social fields", () => {
    expect(Object.keys(fieldsOf("WatchRouteSnapshotLocale"))).toEqual(
      expect.arrayContaining([
        "searchTitle",
        "searchDescription",
        "socialImage",
      ]),
    )
    expect(Object.keys(fieldsOf("WatchRouteSnapshotSocialImage"))).toEqual(
      expect.arrayContaining(["url", "width", "height", "mimeType"]),
    )
    expect(schema.getType("WatchRouteSnapshotRootLocale")).toBeUndefined()
  })

  it("exposes canonical order on Watch child relations", () => {
    const fields = fieldsOf("WatchRouteSnapshotChildRelation") as Record<
      string,
      { type: { toString(): string } }
    >

    expect(fields.order?.type.toString()).toBe("Int")
    expect(fields.child?.type.toString()).toBe("WatchRouteSnapshotChild")
  })

  it("Manager session/read/job contract types expose the expected shape", () => {
    expect(Object.keys(fieldsOf("ManagerViewer"))).toEqual(
      expect.arrayContaining([
        "id",
        "username",
        "email",
        "managerRole",
        "permission",
      ]),
    )
    expect(Object.keys(fieldsOf("ManagerLanguageGeo"))).toEqual(
      expect.arrayContaining(["continents", "countries", "languages"]),
    )
    expect(Object.keys(fieldsOf("ManagerLanguage"))).toEqual(
      expect.arrayContaining(["id", "coreId", "bcp47", "iso3"]),
    )
    expect(Object.keys(fieldsOf("ManagerVideoForEnrichment"))).toEqual(
      expect.arrayContaining([
        "documentId",
        "coreId",
        "title",
        "label",
        "primaryLanguage",
        "variants",
      ]),
    )
    expect(Object.keys(fieldsOf("ManagerEnrichmentVariant"))).toEqual(
      expect.arrayContaining(["language", "muxVideo", "downloads"]),
    )
    expect(Object.keys(fieldsOf("ManagerVideoCoverage"))).toEqual(
      expect.arrayContaining([
        "documentId",
        "coreId",
        "parentDocumentIds",
        "parentRelations",
        "coverage",
      ]),
    )
    expect(Object.keys(fieldsOf("ManagerJob"))).toEqual(
      expect.arrayContaining([
        "id",
        "muxAssetId",
        "languages",
        "status",
        "steps",
        "errors",
      ]),
    )
  })

  it("WatchSetting type exposes the consumer-shape fields (documentId, homepageExperience, defaultTemplateExperience)", () => {
    const fields = fieldsOf("WatchSetting")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "documentId",
        "homepageExperience",
        "defaultTemplateExperience",
      ]),
    )
  })

  it("VideoForEnrichment type (feat-125) exposes the dispatch-fields projection with the expected nullability", () => {
    const fields = fieldsOf("VideoForEnrichment")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "coreId",
        "label",
        "primaryLanguageBcp47",
        "muxAssetId",
        "subtitleUrl",
      ]),
    )
    // id + coreId are non-null per the service contract; the rest
    // are nullable so manager can classify missing fields as
    // `validation_failed`.
    const nonNull = (key: string) =>
      String((fields[key] as { type: unknown }).type).endsWith("!")
    expect(nonNull("id")).toBe(true)
    expect(nonNull("coreId")).toBe(true)
    expect(nonNull("label")).toBe(false)
    expect(nonNull("primaryLanguageBcp47")).toBe(false)
    expect(nonNull("muxAssetId")).toBe(false)
    expect(nonNull("subtitleUrl")).toBe(false)
  })

  it("WatchLanguageInventory type exposes the localized /videos card contract", () => {
    const inventoryFields = fieldsOf("WatchLanguageInventory")
    expect(Object.keys(inventoryFields)).toEqual(
      expect.arrayContaining([
        "language",
        "counts",
        "promoted",
        "audioCollections",
        "audioVideos",
        "subtitleOnlyVideos",
      ]),
    )

    const itemFields = fieldsOf("WatchLanguageInventoryItem")
    expect(Object.keys(itemFields)).toEqual(
      expect.arrayContaining([
        "id",
        "coreId",
        "slug",
        "title",
        "description",
        "imageUrl",
        "imageAlt",
        "label",
        "availability",
        "watchLanguageSlug",
        "parentSlug",
        "parentTitle",
        "durationSeconds",
        "childCount",
        "publishedAt",
      ]),
    )

    const query = schema.getQueryType()!.getFields().watchLanguageInventory
    expect(String(query.type)).toBe("WatchLanguageInventory!")
    expect(query.args.map((arg) => arg.name).sort()).toEqual([
      "languageSlug",
      "limit",
    ])
  })

  it("WatchSearch type exposes the replacement multilingual contract skeleton", () => {
    const query = schema.getQueryType()!.getFields().watchSearch
    expect(String(query.type)).toBe("WatchSearchResponse")
    expect(query.args.map((arg) => arg.name)).toEqual(["input"])

    expect(Object.keys(fieldsOf("WatchSearchResponse"))).toEqual(
      expect.arrayContaining([
        "query",
        "results",
        "hasMore",
        "nextOffset",
        "searchMode",
        "requestId",
        "degraded",
        "latencyMs",
        "laneStatuses",
        "languageInterpretation",
      ]),
    )

    expect(Object.keys(fieldsOf("WatchSearchLaneStatus"))).toEqual(
      expect.arrayContaining([
        "lane",
        "status",
        "elapsedMs",
        "resultCount",
        "reason",
        "detail",
      ]),
    )

    expect(Object.keys(fieldsOf("WatchSearchResult"))).toEqual(
      expect.arrayContaining([
        "type",
        "id",
        "slug",
        "title",
        "snippet",
        "imageUrl",
        "playbackId",
        "startSeconds",
        "score",
        "label",
        "durationSeconds",
        "childCount",
        "languageSlug",
        "languageEnglishName",
        "availability",
        "evidence",
        "action",
        "fallback",
      ]),
    )

    expect(Object.keys(fieldsOf("WatchSearchLanguageInterpretation"))).toEqual(
      expect.arrayContaining([
        "queryLanguageSlug",
        "queryNamedLanguageSlug",
        "targetLanguageSlug",
        "targetLanguageSource",
        "displayLanguageSlug",
        "routeLanguageSlug",
        "currentWatchLanguageSlug",
        "acceptLanguage",
        "acceptLanguageSlug",
      ]),
    )
  })

  it("Query root no longer exposes the Unit 3 Ping spike fields", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.pingAll).toBeUndefined()
    expect(fields.pingPublic).toBeUndefined()
  })

  it("Mutation root exposes the experience embedding trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.triggerExperienceEmbedding).toBeDefined()
  })

  it("Mutation root exposes Manager job write contracts", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.createManagerJob).toBeDefined()
    expect(fields.updateManagerJob).toBeDefined()
  })

  it("Mutation root exposes the private watch-event write contract", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.recordWatchEvent).toBeDefined()
  })

  it("Mutation root exposes media asset write entry points", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.registerMediaAsset).toBeDefined()
    expect(fields.updateMediaAsset).toBeDefined()
    expect(fields.updateMediaAssetLocale).toBeDefined()
    expect(fields.triggerMediaImageEnrichment).toBeDefined()
    expect(fields.deleteMediaAsset).toBeDefined()
    expect(fields.createMediaFolder).toBeDefined()
    expect(fields.updateMediaFolder).toBeDefined()
    expect(fields.deleteMediaFolder).toBeDefined()
  })

  it("Mutation root does not expose the retired scene embedding backfill trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.triggerSceneEmbeddingBackfill).toBeUndefined()
  })

  it("Mutation root exposes the transcript embedding backfill trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    // (Test added retroactively in R3 — R2 shipped without it.)
    expect(fields.triggerTranscriptEmbeddingBackfill).toBeDefined()
  })

  it("Mutation root exposes the admin-native experience-embedding backfill trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.triggerExperienceEmbeddingBackfill).toBeDefined()
  })

  it("triggerExperienceEmbeddingBackfill declares optional experienceIds + bcp47Locales + force + mode args", () => {
    const mutation = schema.getMutationType()!
    const field = mutation.getFields().triggerExperienceEmbeddingBackfill!
    const experienceIds = field.args.find((a) => a.name === "experienceIds")
    const bcp47Locales = field.args.find((a) => a.name === "bcp47Locales")
    const force = field.args.find((a) => a.name === "force")
    const mode = field.args.find((a) => a.name === "mode")
    expect(experienceIds).toBeDefined()
    expect(bcp47Locales).toBeDefined()
    expect(force).toBeDefined()
    expect(mode).toBeDefined()
    // experienceIds and bcp47Locales are nullable inclusion-filter lists.
    expect(String(experienceIds!.type)).toBe("[ID!]")
    expect(String(bcp47Locales!.type)).toBe("[String!]")
    // force is nullable Boolean (defaultValue: false on the resolver).
    expect(String(force!.type)).toBe("Boolean")
    // mode is nullable String, parsed by the resolver into the ingest mode.
    expect(String(mode!.type)).toBe("String")
  })

  it("Mutation root does NOT expose the retired experience-content-dump trigger", () => {
    // Defense-in-depth: the cms-coupled dump mutation was removed in
    // docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md.
    // A regression that re-introduces it should fail loudly here.
    const mutation = schema.getMutationType()!
    expect(mutation.getFields().triggerExperienceContentDump).toBeUndefined()
  })
})

describe("MediaAsset type", () => {
  it("exposes image enrichment metadata and localized rows", () => {
    const fields = fieldsOf("MediaAsset")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "blurDataUrl",
        "imageEnrichmentStatus",
        "imageEnrichmentErrorMessage",
        "locales",
      ]),
    )
  })

  it("MediaAssetLocale exposes provenance and override locks", () => {
    const fields = fieldsOf("MediaAssetLocale")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "locale",
        "displayName",
        "altText",
        "displayNameSource",
        "altTextSource",
        "displayNameLocked",
        "altTextLocked",
        "status",
      ]),
    )
  })
})

describe("VideoScene and VideoSceneLocale types", () => {
  it("VideoScene exposes timecode + edition fields but NOT embedding-shaped fields", () => {
    const fields = fieldsOf("VideoScene")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "videoEditionId",
        "videoId",
        "sceneIndex",
        "startSeconds",
        "endSeconds",
        "chapterTitle",
        "locales",
      ]),
    )
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
  })

  it("VideoSceneLocale exposes the public description + metadata but NOT the embedding", () => {
    const fields = fieldsOf("VideoSceneLocale")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "videoSceneId",
        "locale",
        "description",
        "themes",
        "bibleVerses",
        "demographics",
        "spiritualContext",
      ]),
    )
    // Operational / technical columns must not leak into GraphQL.
    expect(fields.embedding).toBeUndefined()
    expect(fields.sourceText).toBeUndefined()
    expect(fields.model).toBeUndefined()
    expect(fields.dimensions).toBeUndefined()
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
  })
})

describe("Experience type", () => {
  it("exposes the canonical shape (no embedding field)", () => {
    const fields = fieldsOf("Experience")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "isTemplate",
        "ownerId",
        "archivedAt",
        "createdAt",
        "updatedAt",
        "locales",
      ]),
    )
  })

  it("EXCLUDES the embedding column from the schema (R20 technical control)", () => {
    const fields = fieldsOf("Experience")
    expect(fields.embedding).toBeUndefined()
    // The cms_* dump-snapshot columns live on ExperienceLocale, not on
    // Experience — see the matching ExperienceLocale-side assertion
    // for the actual leak guard. The Experience-side check stays
    // defensive against future Pothos type-extensions that might pull
    // those fields up via a relation.
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(
        /embed|vector|similarit|cms_?content_?hash|cms_?document_?id|cms_?dumped_?at/i,
      )
    }
  })

  it("locales field returns a list of ExperienceLocale", () => {
    const fields = fieldsOf("Experience") as Record<
      string,
      { type: { toString(): string } }
    >
    const localesType = fields.locales.type.toString()
    expect(localesType).toMatch(/ExperienceLocale/)
    expect(localesType.startsWith("[")).toBe(true)
  })
})

describe("ExperienceLocale type", () => {
  it("exposes blocks as a typed ExperienceBlock list and status as enum", () => {
    const fields = fieldsOf("ExperienceLocale") as Record<
      string,
      { type: { toString(): string } }
    >
    // The blocks field switched from JSON scalar to a non-null list of the
    // typed `ExperienceBlock` union (U3 of the admin direct-cutover plan).
    // Mutations still accept JSON input — see mutations/experience.ts.
    expect(fields.blocks.type.toString()).toMatch(/ExperienceBlock/)
    expect(fields.blocks.type.toString()).not.toMatch(/JSON/)
    expect(fields.status.type.toString()).toMatch(/LocaleStatus/)
  })

  it("does not expose any embedding-shaped field", () => {
    const fields = fieldsOf("ExperienceLocale")
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
  })

  it("does not expose the R3 dump-snapshot columns via GraphQL", () => {
    const fields = fieldsOf("ExperienceLocale")
    expect(fields.cmsDocumentId).toBeUndefined()
    expect(fields.cmsDumpedAt).toBeUndefined()
    expect(fields.cmsContentHash).toBeUndefined()
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(
        /cms_?content_?hash|cms_?document_?id|cms_?dumped_?at/i,
      )
    }
  })
})

describe("Video type", () => {
  it("exposes the canonical read-side fields", () => {
    const fields = fieldsOf("Video")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "coreId",
        "slug",
        "label",
        "videoSource",
        "publishedAt",
        "locked",
        "noIndex",
        "aiMetadata",
        "locales",
        "dubs",
        "muxPlaybackId",
        "studyQuestions",
        "bibleCitations",
      ]),
    )
  })

  it("no longer exposes the legacy `variants` alias", () => {
    const fields = fieldsOf("Video")
    expect(fields.variants).toBeUndefined()
  })

  it("does NOT expose subtitles directly (they attach to VideoEdition)", () => {
    const fields = fieldsOf("Video")
    expect(fields.subtitles).toBeUndefined()
  })

  it("localized content relations accept broad locale and exact languageSlug arguments", () => {
    const fields = fieldsOf("Video") as Record<
      string,
      { args: Array<{ name: string; type: { toString(): string } }> }
    >
    const studyLocaleArg = fields.studyQuestions.args.find(
      (arg) => arg.name === "locale",
    )
    const studyLanguageSlugArg = fields.studyQuestions.args.find(
      (arg) => arg.name === "languageSlug",
    )
    const localesLocaleArg = fields.locales.args.find(
      (arg) => arg.name === "locale",
    )
    const localesLanguageSlugArg = fields.locales.args.find(
      (arg) => arg.name === "languageSlug",
    )
    const muxPlaybackLanguageSlugArg = fields.muxPlaybackId.args.find(
      (arg) => arg.name === "languageSlug",
    )
    expect(studyLocaleArg?.type.toString()).toBe("String")
    expect(studyLanguageSlugArg?.type.toString()).toBe("String")
    expect(localesLocaleArg?.type.toString()).toBe("String")
    expect(localesLanguageSlugArg?.type.toString()).toBe("String")
    expect(muxPlaybackLanguageSlugArg?.type.toString()).toBe("String")
  })

  it("localized content rows expose variant identity diagnostics", () => {
    const localeFields = fieldsOf("VideoLocale")
    expect(Object.keys(localeFields)).toEqual(
      expect.arrayContaining(["locale", "languageSlug", "languageCoreId"]),
    )

    const questionFields = fieldsOf("VideoStudyQuestion")
    expect(Object.keys(questionFields)).toEqual(
      expect.arrayContaining(["locale", "languageSlug", "languageCoreId"]),
    )
  })
})

describe("MediaAsset type", () => {
  it("exposes media metadata and stable app routes without raw object keys", () => {
    const fields = fieldsOf("MediaAsset")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "kind",
        "backend",
        "status",
        "visibility",
        "mimeType",
        "byteSize",
        "previewUrl",
        "downloadUrl",
        "editUrl",
        "createdById",
      ]),
    )
    expect(fields.objectKey).toBeUndefined()
    expect(fields.previewObjectKey).toBeUndefined()
    expect(fields.muxAssetId).toBeUndefined()
    expect(fields.muxUploadId).toBeUndefined()
  })
})

describe("MediaAssetUsage type", () => {
  it("exposes structured where-used references", () => {
    const fields = fieldsOf("MediaAssetUsage")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "resourceType",
        "resourceId",
        "resourceLocaleId",
        "locale",
        "editUrl",
        "recoverable",
        "location",
        "fieldPath",
        "fieldName",
        "match",
      ]),
    )
  })
})

describe("VideoEdition type", () => {
  it("exposes dubs and subtitles (subtitles attach to edition for timecode alignment)", () => {
    const fields = fieldsOf("VideoEdition")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["id", "coreId", "name", "dubs", "subtitles"]),
    )
  })
})

describe("VideoDub type (formerly VideoVariant)", () => {
  it("exposes lengthInMilliseconds as a string (BigInt safety)", () => {
    const fields = fieldsOf("VideoDub") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.lengthInMilliseconds.type.toString()).toBe("String")
  })

  it("exposes Core media attachments", () => {
    const fields = fieldsOf("VideoDub")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["brightcoveId", "muxVideo", "downloads"]),
    )
  })
})

describe("reference types", () => {
  it("Language exposes first-class locale rows for translated names", () => {
    const fields = fieldsOf("Language") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.name.type.toString()).toMatch(/JSON/)
    expect(fields.locales.type.toString()).toBe("[LanguageLocale!]")
    expect(fields.audioPreviewSize.type.toString()).toBe("String")
  })

  it("Country exposes localized names, `continent`, and country-language coverage", () => {
    const fields = fieldsOf("Country") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.locales.type.toString()).toBe("[CountryLocale!]")
    expect(fields.continent.type.toString()).toBe("Continent")
    expect(fields.languageCount.type.toString()).toBe("Int")
    expect(fields.languageHavingMediaCount.type.toString()).toBe("Int")
    expect(fields.countryLanguages.type.toString()).toBe("[CountryLanguage!]")
  })

  it("Continent exposes first-class localized names", () => {
    const fields = fieldsOf("Continent") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.locales.type.toString()).toBe("[ContinentLocale!]")
  })

  it("CountryLanguage exposes Core relation metadata", () => {
    const fields = fieldsOf("CountryLanguage")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "coreId",
        "speakers",
        "displaySpeakers",
        "primary",
        "suggested",
        "order",
        "country",
        "language",
      ]),
    )
  })
})

describe("Scene recommendations — R5 query + type", () => {
  it("Query root exposes the `sceneRecommendations` field", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.sceneRecommendations).toBeTruthy()
  })

  it("sceneRecommendations returns [SceneRecommendation!]!", () => {
    const fields = schema.getQueryType()!.getFields()
    const field = fields.sceneRecommendations!
    expect(String(field.type)).toBe("[SceneRecommendation!]!")
  })

  it("sceneRecommendations args: videoId/slug optional, locale required, sceneIndex/limit optional", () => {
    const fields = schema.getQueryType()!.getFields()
    const args = fields.sceneRecommendations!.args
    const byName = Object.fromEntries(args.map((a) => [a.name, a]))
    expect(String(byName.videoId!.type)).toBe("ID")
    expect(String(byName.slug!.type)).toBe("String")
    expect(String(byName.locale!.type)).toBe("String!")
    expect(String(byName.sceneIndex!.type)).toBe("Int")
    expect(String(byName.limit!.type)).toBe("Int")
  })

  it("SceneRecommendation exposes cms-parity fields", () => {
    const fields = fieldsOf("SceneRecommendation") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "videoId",
        "videoSlug",
        "videoTitle",
        "imageUrl",
        "sceneIndex",
        "description",
        "startSeconds",
        "endSeconds",
        "similarity",
        "themes",
        "demographics",
        "spiritualContext",
        "playbackId",
      ]),
    )
    // videoId is admin cuid → ID! (was Int! in cms; see plan Key Decision 2)
    expect(fields.videoId!.type.toString()).toBe("ID!")
    expect(fields.videoSlug!.type.toString()).toBe("String!")
    expect(fields.videoTitle!.type.toString()).toBe("String!")
    expect(fields.imageUrl!.type.toString()).toBe("String")
    expect(fields.sceneIndex!.type.toString()).toBe("Int!")
    expect(fields.startSeconds!.type.toString()).toBe("Float!")
    expect(fields.endSeconds!.type.toString()).toBe("Float")
    expect(fields.similarity!.type.toString()).toBe("Float!")
    expect(fields.themes!.type.toString()).toBe("[String!]!")
    expect(fields.demographics!.type.toString()).toBe("[String!]!")
    expect(fields.spiritualContext!.type.toString()).toBe("[String!]!")
    expect(fields.playbackId!.type.toString()).toBe("String!")
  })

  it("SceneRecommendation exposes no embedding/vector-shaped field", () => {
    // `similarity` is allowed (cms parity), so we scan for `embed|vector`
    // only on this type. The broader leak guard elsewhere covers vector
    // leakage across the whole schema.
    const fields = fieldsOf("SceneRecommendation")
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector/i)
    }
  })
})
