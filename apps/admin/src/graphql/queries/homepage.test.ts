import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"
import {
  defaultTemplateExperienceLocaleWhere,
  homepageExperienceLocaleWhere,
  publicExperienceLocaleOrderBy,
} from "./homepage"

describe("homepage/template public query resolvers", () => {
  it("schema exposes the public homepage/template fields", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.homepageExperienceLocale).toBeDefined()
    expect(fields.defaultTemplateExperienceLocale).toBeDefined()
    expect(String(fields.homepageExperienceLocale!.args[0]!.type)).toBe(
      "String!",
    )
    expect(String(fields.defaultTemplateExperienceLocale!.args[0]!.type)).toBe(
      "String!",
    )
  })

  it("homepageExperienceLocale selects published homepage rows only", () => {
    expect(homepageExperienceLocaleWhere("en")).toEqual({
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      experience: { archivedAt: null },
    })
  })

  it("defaultTemplateExperienceLocale selects published template rows only", () => {
    expect(defaultTemplateExperienceLocaleWhere("en")).toEqual({
      locale: "en",
      status: "PUBLISHED",
      experience: {
        archivedAt: null,
        isTemplate: true,
      },
    })
  })

  it("uses deterministic ordering when duplicate homepage/template rows exist", () => {
    expect(publicExperienceLocaleOrderBy).toEqual([
      { updatedAt: "desc" },
      { id: "asc" },
    ])
  })
})
