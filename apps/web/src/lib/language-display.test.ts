import { describe, expect, it } from "vitest"

import { deriveLanguageDisplay, titleCaseSlug } from "./language-display"

describe("titleCaseSlug", () => {
  it("title-cases a single-word slug", () => {
    expect(titleCaseSlug("english")).toBe("English")
  })

  it("converts hyphens to spaces and title-cases each word", () => {
    expect(titleCaseSlug("arabic-modern-standard")).toBe(
      "Arabic Modern Standard",
    )
  })

  it("ignores empty hyphen-separated segments", () => {
    expect(titleCaseSlug("a--b")).toBe("A B")
  })

  it("handles a single-letter slug", () => {
    expect(titleCaseSlug("a")).toBe("A")
  })
})

describe("deriveLanguageDisplay — Strapi name is the English form", () => {
  // When Strapi's name is a richer-punctuation version of the slug, use it
  // verbatim. No subtitle.

  it("preserves a hyphen in the English form ('A-Hmao')", () => {
    expect(deriveLanguageDisplay("a-hmao", "A-Hmao")).toEqual({
      slug: "a-hmao",
      name: "A-Hmao",
      nativeName: null,
    })
  })

  it("preserves a space in the English form ('A Che')", () => {
    expect(deriveLanguageDisplay("ache", "A Che")).toEqual({
      slug: "ache",
      name: "A Che",
      nativeName: null,
    })
  })

  it("preserves a comma in the English form ('Achi, Rabinal')", () => {
    expect(deriveLanguageDisplay("achi-rabinal", "Achi, Rabinal")).toEqual({
      slug: "achi-rabinal",
      name: "Achi, Rabinal",
      nativeName: null,
    })
  })

  it("uses the English form verbatim when slug and name agree", () => {
    expect(deriveLanguageDisplay("english", "English")).toEqual({
      slug: "english",
      name: "English",
      nativeName: null,
    })
  })

  it("trims whitespace from rawName", () => {
    expect(deriveLanguageDisplay("english", "  English  ")).toEqual({
      slug: "english",
      name: "English",
      nativeName: null,
    })
  })
})

describe("deriveLanguageDisplay — Strapi name is the native form", () => {
  // When name contains non-ASCII chars, treat it as the native form. Show
  // slug-derived English as primary, name as subtitle.

  it("surfaces a Cyrillic native form ('Адыгэбзэ' under 'Adygey')", () => {
    expect(deriveLanguageDisplay("adygey", "Адыгэбзэ")).toEqual({
      slug: "adygey",
      name: "Adygey",
      nativeName: "Адыгэбзэ",
    })
  })

  it("surfaces an Arabic native form", () => {
    expect(
      deriveLanguageDisplay("arabic-modern-standard", "اللغة العربية"),
    ).toEqual({
      slug: "arabic-modern-standard",
      name: "Arabic Modern Standard",
      nativeName: "اللغة العربية",
    })
  })

  it("surfaces a Latin native with diacritics ('Français' under 'French')", () => {
    expect(deriveLanguageDisplay("french", "Français")).toEqual({
      slug: "french",
      name: "French",
      nativeName: "Français",
    })
  })

  it("surfaces a Latin native with special punctuation ('ʿAfár af' under 'Afar')", () => {
    expect(deriveLanguageDisplay("afar", "ʿAfár af")).toEqual({
      slug: "afar",
      name: "Afar",
      nativeName: "ʿAfár af",
    })
  })

  it("surfaces an ASCII-only native that contains letters not in the slug ('Shqip' under 'Albanian')", () => {
    expect(deriveLanguageDisplay("albanian", "Shqip")).toEqual({
      slug: "albanian",
      name: "Albanian",
      nativeName: "Shqip",
    })
  })

  it("suppresses the subtitle when slug-derived English exactly equals name", () => {
    expect(deriveLanguageDisplay("shqip", "Shqip")).toEqual({
      slug: "shqip",
      name: "Shqip",
      nativeName: null,
    })
  })
})

describe("deriveLanguageDisplay — missing name", () => {
  it("falls back to slug-derived English when name is null/undefined/empty", () => {
    expect(deriveLanguageDisplay("adygey", null)).toEqual({
      slug: "adygey",
      name: "Adygey",
      nativeName: null,
    })
    expect(deriveLanguageDisplay("adygey", undefined)).toEqual({
      slug: "adygey",
      name: "Adygey",
      nativeName: null,
    })
    expect(deriveLanguageDisplay("adygey", "").nativeName).toBeNull()
    expect(deriveLanguageDisplay("adygey", "   ").nativeName).toBeNull()
  })
})
