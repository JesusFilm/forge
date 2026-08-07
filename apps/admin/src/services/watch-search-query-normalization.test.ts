import { describe, expect, it } from "vitest"
import { watchSearchQueryVariants } from "./watch-search-query-normalization"

describe("watchSearchQueryVariants", () => {
  it.each(["Isus", "Iisus", "  ISUS  "])(
    "adds the canonical JESUS title for Romanian query %s",
    (query) => {
      expect(watchSearchQueryVariants(query, "romanian")).toContain("JESUS")
    },
  )

  it("does not rewrite the canonical title", () => {
    expect(watchSearchQueryVariants("JESUS", "romanian")).toEqual(["JESUS"])
  })

  it("does not expand Romanian spellings for other target languages", () => {
    expect(watchSearchQueryVariants("Isus", "french")).toEqual(["Isus"])
  })
})
