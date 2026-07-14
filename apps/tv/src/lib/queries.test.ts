import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_WATCH_EXPERIENCE, SEMANTIC_SEARCH } from "./queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const experienceSdl = asSdl(GET_WATCH_EXPERIENCE)
const searchSdl = asSdl(SEMANTIC_SEARCH)

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
