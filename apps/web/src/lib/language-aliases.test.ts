import { describe, expect, it } from "vitest"

import {
  LANGUAGE_SLUG_ALIASES,
  tryResolveLanguageAlias,
} from "./language-aliases"

describe("tryResolveLanguageAlias", () => {
  it("resolves a known legacy slug to its canonical", () => {
    expect(tryResolveLanguageAlias("chinese-mandarin")).toBe("mandarin-china")
  })

  it("returns null for an unknown slug", () => {
    expect(tryResolveLanguageAlias("russian")).toBeNull()
    expect(tryResolveLanguageAlias("not-a-language")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(tryResolveLanguageAlias("")).toBeNull()
  })

  it("returns null for prototype-pollution keys (__proto__)", () => {
    expect(tryResolveLanguageAlias("__proto__")).toBeNull()
  })

  it("returns null for prototype-pollution keys (constructor)", () => {
    expect(tryResolveLanguageAlias("constructor")).toBeNull()
  })

  it("returns null for prototype-pollution keys (hasOwnProperty)", () => {
    expect(tryResolveLanguageAlias("hasOwnProperty")).toBeNull()
  })

  it("returns null for prototype-pollution keys (toString)", () => {
    expect(tryResolveLanguageAlias("toString")).toBeNull()
  })

  it("is case-sensitive on legacy slug input", () => {
    expect(tryResolveLanguageAlias("Chinese-Mandarin")).toBeNull()
    expect(tryResolveLanguageAlias("CHINESE-MANDARIN")).toBeNull()
  })
})

describe("LANGUAGE_SLUG_ALIASES table", () => {
  const SAFE_SLUG = /^[a-z0-9-]+$/

  it("every alias canonical matches the safe-slug shape (static-shape invariant)", () => {
    for (const canonical of Object.values(LANGUAGE_SLUG_ALIASES)) {
      expect(canonical).toMatch(SAFE_SLUG)
    }
  })

  it("every alias key matches the safe-slug shape (no prototype-style keys baked in)", () => {
    for (const key of Object.keys(LANGUAGE_SLUG_ALIASES)) {
      expect(key).toMatch(SAFE_SLUG)
    }
  })

  it("is acyclic: no canonical resolves through the alias table to itself or back to its key", () => {
    for (const [legacy, canonical] of Object.entries(LANGUAGE_SLUG_ALIASES)) {
      expect(tryResolveLanguageAlias(canonical)).toBeNull()
      expect(canonical).not.toBe(legacy)
    }
  })
})
