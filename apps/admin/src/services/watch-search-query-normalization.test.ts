import { describe, expect, it } from "vitest"

import { watchSearchQueryVariants } from "./watch-search-query-normalization"

describe("watchSearchQueryVariants", () => {
  it.each([
    ["Isus", ["Isus", "JESUS"]],
    ["Iisus", ["Iisus", "JESUS"]],
    [" ISUS ", [" ISUS ", "JESUS"]],
  ])("adds the Romanian cross-locale variant for %s", (query, expected) => {
    expect(
      watchSearchQueryVariants({
        query,
        targetLanguageSlug: "romanian",
      }),
    ).toEqual(expected)
  })

  it("deduplicates an already canonical Romanian query", () => {
    expect(
      watchSearchQueryVariants({
        query: "JESUS",
        targetLanguageSlug: "romanian",
      }),
    ).toEqual(["JESUS"])
  })

  it("does not apply Romanian vocabulary to another target language", () => {
    expect(
      watchSearchQueryVariants({
        query: "Isus",
        targetLanguageSlug: "english",
      }),
    ).toEqual(["Isus"])
  })

  it("requires the complete lexical form instead of stripping punctuation", () => {
    expect(
      watchSearchQueryVariants({
        query: "Isus!",
        targetLanguageSlug: "romanian",
      }),
    ).toEqual(["Isus!"])
  })

  it.each(["fiul risipitor", "anxietate", "iertare", "Crăciun"])(
    "leaves the Romanian topic query %s unchanged",
    (query) => {
      expect(
        watchSearchQueryVariants({
          query,
          targetLanguageSlug: "romanian",
        }),
      ).toEqual([query])
    },
  )
})
