import { describe, expect, it } from "vitest"

import {
  HARNESS_LOCALES,
  LOCALE_TIER,
  QUICK_LOCALES,
  isHarnessLocale,
} from "./locales"

describe("HARNESS_LOCALES", () => {
  it("contains exactly 30 BCP-47 strings", () => {
    expect(HARNESS_LOCALES).toHaveLength(30)
  })

  it("has no duplicate entries", () => {
    expect(new Set(HARNESS_LOCALES).size).toBe(HARNESS_LOCALES.length)
  })

  it("includes every entry from the brainstorm-resolved list", () => {
    // Snapshot of the 30 entries documented in
    // docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md
    // Deliberately re-typed verbatim so a silent drop is caught.
    expect(HARNESS_LOCALES).toEqual([
      "en",
      "fr",
      "es",
      "ru",
      "ar",
      "pt",
      "de",
      "zh",
      "it",
      "fa",
      "th",
      "hi",
      "vi",
      "tr",
      "ja",
      "es-ES",
      "ko",
      "bn",
      "id",
      "pt-PT",
      "ro",
      "km",
      "zh-hans",
      "yue",
      "ur",
      "fil",
      "te",
      "kk",
      "ta",
      "pl",
    ])
  })
})

describe("LOCALE_TIER", () => {
  it("has a tier for every harness locale", () => {
    for (const locale of HARNESS_LOCALES) {
      expect(LOCALE_TIER[locale]).toBeDefined()
    }
  })

  it("only assigns valid tiers (1, 2, or 3)", () => {
    for (const locale of HARNESS_LOCALES) {
      expect([1, 2, 3]).toContain(LOCALE_TIER[locale])
    }
  })

  it("has at least one entry in each tier", () => {
    const tiers = new Set(HARNESS_LOCALES.map((l) => LOCALE_TIER[l]))
    expect(tiers).toEqual(new Set([1, 2, 3]))
  })
})

describe("QUICK_LOCALES", () => {
  it("is a subset of HARNESS_LOCALES", () => {
    for (const locale of QUICK_LOCALES) {
      expect(HARNESS_LOCALES).toContain(locale)
    }
  })

  it("contains only Tier 1 or Tier 2 locales (judge handles strongly)", () => {
    // Tier 1 = Romance/Germanic; Tier 2 = major non-Latin.
    // Tier 3 locales (regional variants, low-resource) intentionally
    // excluded — quick mode optimises for judge confidence, not breadth.
    for (const locale of QUICK_LOCALES) {
      expect(LOCALE_TIER[locale]).toBeLessThanOrEqual(2)
    }
  })

  it("has 6 entries (per brainstorm R4a)", () => {
    expect(QUICK_LOCALES).toHaveLength(6)
  })
})

describe("isHarnessLocale", () => {
  it("returns true for known harness locales", () => {
    expect(isHarnessLocale("en")).toBe(true)
    expect(isHarnessLocale("zh-hans")).toBe(true)
    expect(isHarnessLocale("pt-PT")).toBe(true)
  })

  it("returns false for unknown locales", () => {
    expect(isHarnessLocale("xx")).toBe(false)
    expect(isHarnessLocale("EN")).toBe(false) // case-sensitive
    expect(isHarnessLocale("")).toBe(false)
  })
})
