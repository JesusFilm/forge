import { print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  GET_WATCH_SETTING,
  GET_WATCH_EXPERIENCE,
  SEMANTIC_SEARCH,
} from "./queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const settingSdl = asSdl(GET_WATCH_SETTING)
const experienceSdl = asSdl(GET_WATCH_EXPERIENCE)
const searchSdl = asSdl(SEMANTIC_SEARCH)

describe("GET_WATCH_SETTING (public homepage resolution)", () => {
  it("queries the watchSetting root field", () => {
    expect(settingSdl).toContain("watchSetting(locale: $locale)")
  })

  it("selects the homepageExperience slug (the only field the home needs)", () => {
    expect(settingSdl).toContain("homepageExperience")
    expect(settingSdl).toContain("slug")
  })

  it("declares the $locale variable", () => {
    expect(settingSdl).toContain("$locale: String!")
  })

  // Regression guard: the editor-gated Query.experiences 401s for the public TV
  // app; the home must resolve the homepage via the PUBLIC watchSetting query. A
  // failure here means the home regressed onto the gated list query.
  it("does NOT touch the editor-gated Query.experiences", () => {
    expect(settingSdl).not.toMatch(/\bexperiences\b/)
  })
})

describe("GET_WATCH_EXPERIENCE (public single experience, powers the home)", () => {
  it("resolves an experience via the PUBLIC experienceBySlug field", () => {
    expect(experienceSdl).toContain(
      "experienceBySlug(locale: $locale, slug: $slug)",
    )
  })

  it("does NOT use the editor-gated Query.experiences list field", () => {
    // experienceBySlug is public; the bare `experiences` list field is gated.
    expect(experienceSdl).not.toMatch(/\bexperiences\b/)
  })
})

describe("SEMANTIC_SEARCH (hybrid search results)", () => {
  it("queries the public search root field", () => {
    expect(searchSdl).toContain("search(")
  })

  // searchResultPath routes series-shaped results (isSeriesSearchResult:
  // label OR childCount) straight to /series — both signals must be selected
  // or every series result silently degrades to the /watch hop.
  it("selects label and childCount for series routing", () => {
    expect(searchSdl).toMatch(/\blabel\b/)
    expect(searchSdl).toMatch(/\bchildCount\b/)
  })
})
