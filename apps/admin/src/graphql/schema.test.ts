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
    // Widen the check to catch variant names a future careless addition
    // might use.
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
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
    expect(fields.status.type.toString()).toMatch(/ExperienceLocaleStatus/)
  })

  it("does not expose any embedding-shaped field", () => {
    const fields = fieldsOf("ExperienceLocale")
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/embed|vector|similarit/i)
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
        "variants",
      ]),
    )
  })
})

describe("VideoVariant type", () => {
  it("exposes lengthInMilliseconds as a string (BigInt safety)", () => {
    const fields = fieldsOf("VideoVariant") as Record<
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
