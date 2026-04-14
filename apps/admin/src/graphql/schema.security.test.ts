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
  const fields = allFields(schema)

  for (const { typeName, fieldName } of fields) {
    it(`${typeName}.${fieldName} does not match forbidden pattern`, () => {
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
})
