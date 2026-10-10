import { describe, expect, it } from "vitest"

import {
  SEARCH_EVAL_LOCALES,
  SEARCH_EVAL_LOCALE_TIER,
  isSearchEvalLocale,
} from "./search-eval-locale-profiles"

describe("SEARCH_EVAL_LOCALES", () => {
  it("contains exactly 30 BCP-47 strings", () => {
    expect(SEARCH_EVAL_LOCALES).toHaveLength(30)
  })

  it("has no duplicate entries", () => {
    expect(new Set(SEARCH_EVAL_LOCALES).size).toBe(SEARCH_EVAL_LOCALES.length)
  })

  it("includes every entry from the brainstorm-resolved list", () => {
    // Snapshot of the 30 entries documented in
    // docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md
    // Deliberately re-typed verbatim so a silent drop is caught.
    expect(SEARCH_EVAL_LOCALES).toEqual([
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

describe("SEARCH_EVAL_LOCALE_TIER", () => {
  it("has a tier for every search-eval locale", () => {
    for (const locale of SEARCH_EVAL_LOCALES) {
      expect(SEARCH_EVAL_LOCALE_TIER[locale]).toBeDefined()
    }
  })

  it("only assigns valid tiers (1, 2, or 3)", () => {
    for (const locale of SEARCH_EVAL_LOCALES) {
      expect([1, 2, 3]).toContain(SEARCH_EVAL_LOCALE_TIER[locale])
    }
  })

  it("has at least one entry in each tier", () => {
    const tiers = new Set(
      SEARCH_EVAL_LOCALES.map((locale) => SEARCH_EVAL_LOCALE_TIER[locale]),
    )
    expect(tiers).toEqual(new Set([1, 2, 3]))
  })
})

describe("isSearchEvalLocale", () => {
  it("returns true for known search-eval locales", () => {
    expect(isSearchEvalLocale("en")).toBe(true)
    expect(isSearchEvalLocale("zh-hans")).toBe(true)
    expect(isSearchEvalLocale("pt-PT")).toBe(true)
  })

  it("returns false for unknown locales", () => {
    expect(isSearchEvalLocale("xx")).toBe(false)
    expect(isSearchEvalLocale("EN")).toBe(false) // case-sensitive
    expect(isSearchEvalLocale("")).toBe(false)
  })
})
