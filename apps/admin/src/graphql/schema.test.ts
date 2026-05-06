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
        // Manager backend migration contracts
        "managerViewer",
        "managerLanguageGeo",
        "managerVideoCoverage",
        "managerCoverageSnapshots",
        "managerJobs",
        "managerJob",
        // Experience
        "experience",
        "experiences",
        "experienceBySlug",
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

  it("Mutation root exposes the scene embedding backfill trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.triggerSceneEmbeddingBackfill).toBeDefined()
  })

  it("triggerSceneEmbeddingBackfill.mappingS3Key is optional with the canonical default", () => {
    const mutation = schema.getMutationType()!
    const field = mutation.getFields().triggerSceneEmbeddingBackfill!
    const arg = field.args.find((a) => a.name === "mappingS3Key")
    expect(arg).toBeDefined()
    // Nullable (String, not String!) so clients may omit or pass null;
    // defaultValue holds the canonical admin-migrations/ snapshot.
    expect(String(arg!.type)).toBe("String")
    expect(arg!.defaultValue).toBe("admin-migrations/core-id-mapping.json")
  })

  it("Mutation root exposes the transcript embedding backfill trigger", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    // (Test added retroactively in R3 — R2 shipped without it.)
    expect(fields.triggerTranscriptEmbeddingBackfill).toBeDefined()
  })

  it("Mutation root exposes the experience content dump trigger (R3)", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.triggerExperienceContentDump).toBeDefined()
  })

  it("Mutation root exposes Manager job persistence scaffolding", () => {
    const mutation = schema.getMutationType()
    expect(mutation).toBeTruthy()
    const fields = mutation!.getFields()
    expect(fields.createManagerJob).toBeDefined()
    expect(fields.updateManagerJob).toBeDefined()
  })

  it("triggerExperienceContentDump declares optional documentIds + locales args", () => {
    const mutation = schema.getMutationType()!
    const field = mutation.getFields().triggerExperienceContentDump!
    const documentIds = field.args.find((a) => a.name === "documentIds")
    const locales = field.args.find((a) => a.name === "locales")
    expect(documentIds).toBeDefined()
    expect(locales).toBeDefined()
    // Both are nullable lists ([String!]) so clients may omit or pass
    // null; the workflow itself treats length-0 arrays as omitted.
    expect(String(documentIds!.type)).toBe("[String!]")
    expect(String(locales!.type)).toBe("[String!]")
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
  it("exposes blocks as JSON and status as enum", () => {
    const fields = fieldsOf("ExperienceLocale") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.blocks.type.toString()).toMatch(/JSON/)
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
        "experienceId",
        "experienceLocaleId",
        "locale",
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

describe("Hybrid search — R4 query + response types", () => {
  it("Query root exposes the `search` field", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.search).toBeTruthy()
  })

  it("HybridSearchResult exposes the expected consumer-facing shape", () => {
    const fields = fieldsOf("HybridSearchResult") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "type",
        "id",
        "slug",
        "title",
        "imageUrl",
        "snippet",
        "startSeconds",
        "playbackId",
        "score",
      ]),
    )
    expect(fields.score.type.toString()).toBe("Float!")
    expect(fields.startSeconds.type.toString()).toBe("Float")
    expect(fields.playbackId.type.toString()).toBe("String")
  })

  it("HybridSearchResult exposes no embedding/vector/similarity-shaped field", () => {
    const fields = fieldsOf("HybridSearchResult")
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
  })

  it("HybridSearchResultDebug exposes ranks + fusedScore + dilutionCapApplied (no embedding leak)", () => {
    const fields = fieldsOf("HybridSearchResultDebug") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "retrieverRanks",
        "fusedScore",
        "dilutionCapApplied",
      ]),
    )
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
    expect(fields.fusedScore.type.toString()).toBe("Float!")
    expect(fields.dilutionCapApplied.type.toString()).toBe("Boolean!")
    expect(fields.retrieverRanks.type.toString()).toBe(
      "[HybridSearchRetrieverRank!]!",
    )
  })

  it("HybridSearchRetrieverRank carries label + rank only (no embedding leak)", () => {
    const fields = fieldsOf("HybridSearchRetrieverRank") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(Object.keys(fields).sort()).toEqual(["label", "rank"])
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
    }
    expect(fields.label.type.toString()).toBe("String!")
    expect(fields.rank.type.toString()).toBe("Int!")
  })

  it("HybridSearchResult exposes a nullable debug field gated at the resolver", () => {
    const fields = fieldsOf("HybridSearchResult") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.debug.type.toString()).toBe("HybridSearchResultDebug")
  })

  it("HybridSearchResponse wraps results + hasMore + query + searchMode", () => {
    const fields = fieldsOf("HybridSearchResponse") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.results.type.toString()).toBe("[HybridSearchResult!]!")
    expect(fields.hasMore.type.toString()).toBe("Boolean!")
    expect(fields.query.type.toString()).toBe("String!")
    expect(fields.searchMode.type.toString()).toBe("HybridSearchMode!")
  })

  it("HybridSearchMode enum exposes hybrid + keyword-only values", () => {
    const t = schema.getType("HybridSearchMode")
    expect(t).toBeTruthy()
    const values = (
      t as unknown as { getValues(): { value: string }[] }
    ).getValues()
    const raw = values.map((v) => v.value)
    expect(raw).toContain("hybrid")
    expect(raw).toContain("keyword-only")
  })

  it("HybridSearchContentType enum maps to service-layer values", () => {
    const t = schema.getType("HybridSearchContentType")
    const values = (
      t as unknown as { getValues(): { value: string }[] }
    ).getValues()
    const raw = values.map((v) => v.value)
    expect(raw).toEqual(expect.arrayContaining(["video", "experience"]))
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
