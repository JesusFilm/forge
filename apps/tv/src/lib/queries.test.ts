import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_WATCH_EXPERIENCE, WATCH_SEARCH } from "./queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const experienceSdl = asSdl(GET_WATCH_EXPERIENCE)
const searchSdl = asSdl(WATCH_SEARCH)

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

  it("selects the authored media-collection thumbnail orientation", () => {
    expect(experienceSdl).toContain("thumbnailOrientation")
  })
})

// Restored from the pre-#1622 SEMANTIC_SEARCH suite, retargeted at watchSearch.
describe("WATCH_SEARCH (multilingual watch search)", () => {
  it("queries the public watchSearch root field, not the retired Query.search", () => {
    expect(searchSdl).toContain("watchSearch(input: $input)")
    expect(searchSdl).not.toMatch(/\bsemanticSearch\b/)
  })

  // The operation NAME is the bearer's attach key (authHeaders.SEARCH_OPERATION_NAME).
  it("is named WatchSearch so the consumer bearer attaches", () => {
    expect(searchSdl).toContain("query WatchSearch(")
  })

  // `label` alone routes series (searchResultPath); `childCount` only feeds the
  // result chip's count. Admin returns null for both today, so selecting them is
  // what makes TV correct once it populates them.
  it("selects label for series routing and childCount for the result chip", () => {
    expect(searchSdl).toMatch(/\blabel\b/)
    expect(searchSdl).toMatch(/\bchildCount\b/)
  })

  // playbackId feeds the watch seed; slug/title/id/type are the fields
  // mapWatchSearchResult treats as required and drops rows for.
  it("selects the fields the card and router read", () => {
    for (const field of ["type", "id", "slug", "title", "playbackId"]) {
      expect(searchSdl).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })
})
