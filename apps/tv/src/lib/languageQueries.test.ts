import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_LANGUAGES } from "./languageQueries"

// gql.tada documents are parsed DocumentNode ASTs; serialize back with
// graphql's `print` for string/shape assertions (videoQueries.test.ts pattern).
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const sdl = asSdl(GET_LANGUAGES)

describe("GET_LANGUAGES (Settings picker language list)", () => {
  it("queries the PUBLIC languages root field (public-resolvers allowlist)", () => {
    expect(sdl).toContain("languages(")
  })

  it("pages with limit/offset variables (server caps a page at 500)", () => {
    expect(sdl).toContain("$limit: Int")
    expect(sdl).toContain("$offset: Int")
    expect(sdl).toContain("limit: $limit")
    expect(sdl).toContain("offset: $offset")
  })

  it("selects exactly the fields the picker normalizes (slug identity, name map, bcp47)", () => {
    expect(sdl).toContain("slug")
    expect(sdl).toContain("name")
    expect(sdl).toContain("bcp47")
    // The heavy/irrelevant Language fields must stay unselected — this list is
    // ~2.2k rows and ships to low-end TV hardware.
    expect(sdl).not.toContain("audioPreview")
    expect(sdl).not.toContain("locales")
    expect(sdl).not.toContain("createdAt")
  })
})
