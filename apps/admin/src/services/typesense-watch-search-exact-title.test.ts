import { describe, expect, it } from "vitest"
import { normalizeWatchSearchTitle } from "./typesense-watch-search-ranking"
import {
  normalizeTypesenseWatchExactTitle,
  typesenseWatchExactTitleKey,
} from "./typesense-watch-search-exact-title"

const equivalentTitleGroups = [
  ["  ＪＥＳＵＳ!!  ", "jesus"],
  ["ИИСУС", "иисус"],
  ["《耶稣》", "耶稣"],
  ["「イエス」", "イエス"],
  ["«يسوع»", "يسوع"],
  ["L’Évangile", "l évangile"],
  ["Jesus   ♥", "jesus"],
] as const

describe("Typesense Watch exact-title keys", () => {
  it("normalizes NFKC, case, punctuation, symbols, and whitespace without a locale", () => {
    expect(normalizeTypesenseWatchExactTitle("  ＪＥＳＵＳ!!  ")).toBe("jesus")

    for (const [left, right] of equivalentTitleGroups) {
      expect(typesenseWatchExactTitleKey(left)).toBe(
        typesenseWatchExactTitleKey(right),
      )
    }
  })

  it("returns no key for empty or punctuation-only values", () => {
    expect(typesenseWatchExactTitleKey("")).toBeNull()
    expect(typesenseWatchExactTitleKey("  --- 💛 ___  ")).toBeNull()
  })

  it("returns deterministic fixed-size distinct keys across representative scripts", () => {
    const titles = ["Jesus", "Иисус", "耶稣", "イエス", "يسوع"]
    const keys = titles.map((title) => typesenseWatchExactTitleKey(title))

    expect(keys.every((key) => key?.match(/^[a-f0-9]{32}$/))).toBe(true)
    expect(new Set(keys).size).toBe(titles.length)
    expect(typesenseWatchExactTitleKey("Jesus")).toBe(
      typesenseWatchExactTitleKey("Jesus"),
    )
  })

  it("keeps exact-key variants compatible with existing whole-title normalization", () => {
    for (const [left, right] of equivalentTitleGroups) {
      const leftRanking = normalizeWatchSearchTitle(left)
      const rightRanking = normalizeWatchSearchTitle(right)

      expect(typesenseWatchExactTitleKey(left)).toBe(
        typesenseWatchExactTitleKey(right),
      )
      expect(
        leftRanking.normalized === rightRanking.normalized ||
          leftRanking.compact === rightRanking.compact,
      ).toBe(true)
    }
  })
})
