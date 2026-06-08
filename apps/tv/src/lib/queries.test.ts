import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_WATCH_SETTING, GET_WATCH_EXPERIENCE } from "./queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const settingSdl = asSdl(GET_WATCH_SETTING)
const experienceSdl = asSdl(GET_WATCH_EXPERIENCE)

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

  // Regression guard: the home MUST NOT fetch the editor-gated top-level
  // Query.experiences (authScopes hasPermission "read:experiences") — doing so
  // 401s for the unauthenticated public TV app ("Not authorized to resolve
  // Query.experiences"). The home resolves the homepage via the PUBLIC
  // watchSetting query instead. If this assertion ever fails, the home has
  // regressed back onto the gated list query.
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
