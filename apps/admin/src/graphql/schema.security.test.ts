// GraphQL security surface tests — embedding exclusion + field name scan.
//
// These tests walk the compiled schema and assert that no field leaks
// embedding vectors or exposes internal column names. They complement
// the existing schema.test.ts snapshot tests and the classification
// enforcement in classification.test.ts.

import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

function allFields(s: typeof schema) {
  const result: Array<{ typeName: string; fieldName: string }> = []
  const typeMap = s.getTypeMap()
  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith("__")) continue
    // Duck-type check for object types that have getFields()
    if (typeof (type as { getFields?: unknown }).getFields !== "function")
      continue
    const fields = (
      type as { getFields: () => Record<string, unknown> }
    ).getFields()
    for (const fieldName of Object.keys(fields)) {
      result.push({ typeName, fieldName })
    }
  }
  return result
}

describe("embedding exclusion — field name scan", () => {
  const FORBIDDEN = /embed|vector|similarit/i
  const ALLOWED_ACTION_FIELDS = new Set([
    "Mutation.triggerExperienceEmbedding",
    "Mutation.triggerExperienceEmbeddingBackfill",
    "Mutation.triggerTranscriptEmbeddingBackfill",
    // R5 scene recommendations: `similarity` is a computed Float exposed
    // by cms's identical type. The field carries a scalar number, not an
    // embedding vector. Byte-parity with cms's SceneRecommendation SDL.
    "SceneRecommendation.similarity",
    // The versioned semantic delivery contract preserves the same bounded
    // scalar score for each committed item; it never exposes a vector.
    "SemanticRecommendationDeliveryItem.similarity",
  ])
  const fields = allFields(schema)

  for (const { typeName, fieldName } of fields) {
    it(`${typeName}.${fieldName} does not match forbidden pattern`, () => {
      if (ALLOWED_ACTION_FIELDS.has(`${typeName}.${fieldName}`)) {
        return
      }
      expect(
        FORBIDDEN.test(fieldName),
        `${typeName}.${fieldName} matches /${FORBIDDEN.source}/i — ` +
          `embedding vectors must never be exposed via GraphQL. ` +
          `If this is a search input, rename it (e.g. "query" or "input").`,
      ).toBe(false)
    })
  }
})

describe("embedding exclusion — no 'embedding' type exposed", () => {
  const typeMap = schema.getTypeMap()
  const typeNames = Object.keys(typeMap).filter((n) => !n.startsWith("__"))

  it("no type name contains 'embedding' or 'vector'", () => {
    const matches = typeNames.filter((n) => /embed|vector/i.test(n))
    expect(
      matches,
      `Types matching /embed|vector/i found: ${matches.join(", ")}`,
    ).toEqual([])
  })
})

describe("schema security surface", () => {
  it("Mutation type exists (Unit 7+)", () => {
    expect(schema.getMutationType()).toBeDefined()
  })

  it("Query type exists", () => {
    expect(schema.getQueryType()).toBeDefined()
  })

  it("searchExperiences accepts vector as JSON, not as a named vector type", () => {
    const queryType = schema.getQueryType()!
    const field = queryType.getFields().searchExperiences
    expect(field).toBeDefined()
    // The vector arg should be JSON scalar, not a custom Vector type
    const vectorArg = field.args.find((a) => a.name === "vector")
    expect(vectorArg).toBeDefined()
    expect(vectorArg!.type.toString()).toBe("JSON!")
  })

  it("allows the workflow trigger mutation without exposing embedding fields", () => {
    const mutationType = schema.getMutationType()!
    const field = mutationType.getFields().triggerExperienceEmbedding
    expect(field).toBeDefined()
    expect(field.type.toString()).toBe("JSON")
  })

  it("does not expose Mastra embedding provenance internals", () => {
    const fieldNames = allFields(schema).map(
      ({ typeName, fieldName }) => `${typeName}.${fieldName}`,
    )
    const forbiddenFragments = [
      "sourceContentHash",
      "sourceSummary",
      "embeddingModel",
      "embeddingProvider",
      "embeddingDimensions",
      "embeddingGeneratedAt",
      "embeddingMastraRunId",
      "mastraRunId",
      "generationMode",
      "providerPayload",
    ]

    expect(
      fieldNames.filter((name) =>
        forbiddenFragments.some((fragment) => name.includes(fragment)),
      ),
    ).toEqual([])
  })
})
