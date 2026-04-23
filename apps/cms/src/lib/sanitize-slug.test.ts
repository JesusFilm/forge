import { describe, expect, it } from "vitest"
import { sanitizeSlug, suggestAlternativeSlugs } from "./sanitize-slug"

describe("sanitizeSlug", () => {
  it("accepts a clean lowercase hyphenated slug", () => {
    expect(sanitizeSlug("easter-story")).toEqual({
      ok: true,
      slug: "easter-story",
    })
  })

  it("rejects an empty string", () => {
    expect(sanitizeSlug("")).toEqual({ ok: false, reason: "empty" })
  })

  it("rejects a whitespace-only string as empty", () => {
    expect(sanitizeSlug("   ")).toEqual({ ok: false, reason: "empty" })
  })

  it("rejects a single-character slug as too-short", () => {
    expect(sanitizeSlug("a")).toEqual({ ok: false, reason: "too-short" })
  })

  it("rejects slugs longer than 80 characters", () => {
    const long = "a".repeat(81)
    expect(sanitizeSlug(long)).toEqual({ ok: false, reason: "too-long" })
  })

  it("lowercases and normalizes whitespace and underscores", () => {
    expect(sanitizeSlug("Easter Story_Part 1")).toEqual({
      ok: true,
      slug: "easter-story-part-1",
    })
  })

  it("strips unicode and other non [a-z0-9-] characters", () => {
    expect(sanitizeSlug("café—story!")).toEqual({
      ok: true,
      slug: "caf-story",
    })
  })

  it("collapses double hyphens produced by normalization", () => {
    expect(sanitizeSlug("easter---story")).toEqual({
      ok: true,
      slug: "easter-story",
    })
  })

  it("strips leading and trailing hyphens", () => {
    expect(sanitizeSlug("---easter-story---")).toEqual({
      ok: true,
      slug: "easter-story",
    })
  })

  it("treats all-symbol input as too-short after stripping", () => {
    // `!!!!` → `` after strip, which is empty; we report too-short so the
    // UI can differentiate from a literal blank submit.
    expect(sanitizeSlug("!!!!")).toEqual({ ok: false, reason: "too-short" })
  })

  it("rejects reserved words (case insensitive)", () => {
    expect(sanitizeSlug("admin")).toEqual({ ok: false, reason: "reserved" })
    expect(sanitizeSlug("Watch")).toEqual({ ok: false, reason: "reserved" })
    expect(sanitizeSlug("_next")).toEqual({ ok: false, reason: "reserved" })
  })

  it("coerces non-string input to string before processing", () => {
    expect(sanitizeSlug(null)).toEqual({ ok: false, reason: "empty" })
    expect(sanitizeSlug(undefined)).toEqual({ ok: false, reason: "empty" })
    expect(sanitizeSlug(42)).toEqual({ ok: true, slug: "42" })
  })

  it("accepts numeric-only slugs of length >=2", () => {
    expect(sanitizeSlug("2026")).toEqual({ ok: true, slug: "2026" })
  })

  it("accepts the max-length slug", () => {
    const max = "a".repeat(80)
    expect(sanitizeSlug(max)).toEqual({ ok: true, slug: max })
  })
})

describe("suggestAlternativeSlugs", () => {
  it("returns the slug first when it is not taken", () => {
    expect(suggestAlternativeSlugs("easter", [])).toEqual([
      "easter",
      "easter-2",
      "easter-3",
    ])
  })

  it("returns only suffixed alternatives when the slug is taken", () => {
    expect(suggestAlternativeSlugs("easter", ["easter"])).toEqual([
      "easter-2",
      "easter-3",
      "easter-4",
    ])
  })

  it("skips taken suffixed alternatives", () => {
    expect(
      suggestAlternativeSlugs("easter", ["easter", "easter-2", "easter-3"]),
    ).toEqual(["easter-4", "easter-5", "easter-6"])
  })

  it("caps output at 3 entries", () => {
    const result = suggestAlternativeSlugs("easter", [])
    expect(result.length).toBe(3)
  })
})
