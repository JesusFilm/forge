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
        // Video
        "video",
        "videoBySlug",
        "videos",
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
    // R3 dump-snapshot columns must also stay invisible to GraphQL —
    // they're operational bookkeeping, not editorial content.
    expect(fields.cmsDocumentId).toBeUndefined()
    expect(fields.cmsDumpedAt).toBeUndefined()
    expect(fields.cmsContentHash).toBeUndefined()
    // Widen the check to catch variant names a future careless addition
    // might use.
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
        "locked",
        "noIndex",
        "aiMetadata",
        "locales",
        "dubs",
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
})

describe("reference types", () => {
  it("Language exposes a JSON `name` field (locale map)", () => {
    const fields = fieldsOf("Language") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.name.type.toString()).toMatch(/JSON/)
  })

  it("Country exposes `continent` as a nullable relation", () => {
    const fields = fieldsOf("Country") as Record<
      string,
      { type: { toString(): string } }
    >
    expect(fields.continent.type.toString()).toBe("Continent")
  })
})
