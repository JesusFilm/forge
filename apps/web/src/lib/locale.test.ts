import { describe, expect, it } from "vitest"

import { isLocale, isLocaleSlug } from "./locale"

describe("isLocale (bcp47 only)", () => {
  it("accepts known UI template locales", () => {
    expect(isLocale("en")).toBe(true)
    expect(isLocale("es")).toBe(true)
    expect(isLocale("fr")).toBe(true)
    expect(isLocale("pt")).toBe(true)
    expect(isLocale("de")).toBe(true)
  })

  it("rejects English-name kebab slugs", () => {
    expect(isLocale("russian")).toBe(false)
    expect(isLocale("portuguese-brazil")).toBe(false)
    expect(isLocale("spanish-castilian")).toBe(false)
  })

  it("rejects content slugs", () => {
    expect(isLocale("jesus")).toBe(false)
    expect(isLocale("easter")).toBe(false)
  })
})

describe("isLocaleSlug (bcp47 OR English-name kebab heuristic)", () => {
  it("accepts bcp47 codes", () => {
    expect(isLocaleSlug("en")).toBe(true)
    expect(isLocaleSlug("es")).toBe(true)
  })

  it("accepts multi-segment English-name kebab slugs", () => {
    expect(isLocaleSlug("portuguese-brazil")).toBe(true)
    expect(isLocaleSlug("portuguese-portugal")).toBe(true)
    expect(isLocaleSlug("spanish-castilian")).toBe(true)
    expect(isLocaleSlug("spanish-latin-american")).toBe(true)
    expect(isLocaleSlug("arabic-modern-standard")).toBe(true)
    expect(isLocaleSlug("mandarin-china")).toBe(true)
  })

  it("rejects single-token English-name slugs (heuristic ambiguous with content slugs)", () => {
    // Conservative heuristic: `russian`, `english` collide with content
    // slug shape. The full admin-corpus check is Phase 4. Today these
    // route through the content-slug branch — production-acceptable
    // because the legacy `/watch/russian` shape is rare.
    expect(isLocaleSlug("russian")).toBe(false)
    expect(isLocaleSlug("english")).toBe(false)
  })

  it("rejects content slugs (single-token, no hyphen)", () => {
    expect(isLocaleSlug("jesus")).toBe(false)
    expect(isLocaleSlug("easter")).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isLocaleSlug("")).toBe(false)
  })

  it("rejects uppercase", () => {
    expect(isLocaleSlug("Russian")).toBe(false)
    expect(isLocaleSlug("Portuguese-Brazil")).toBe(false)
  })

  it("rejects slugs starting with digit or hyphen", () => {
    expect(isLocaleSlug("-portuguese-brazil")).toBe(false)
    expect(isLocaleSlug("1-foo")).toBe(false)
  })
})
