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

describe("deriveLanguageDisplay — admin name is displayed verbatim", () => {
  it.each([
    // Names whose letters are absent from the slug — the retired heuristic
    // replaced each with a slug-derived label.
    ["urdu-hoda", "Urdu - C"],
    ["awa-8", "Awa (Papua New Guinea)"],
    ["basque", "Euskera"],
    ["german-pennsylvania", "Pennsylvania Dutch"],
    // Names that merely re-punctuate the slug.
    ["a-hmao", "A-Hmao"],
    ["achi-rabinal", "Achi, Rabinal"],
    ["english", "English"],
  ])("keeps %s as %j", (slug, name) => {
    expect(deriveLanguageDisplay(slug, name)).toEqual({ slug, name })
  })

  it("never swaps a non-ASCII name for the slug", () => {
    expect(deriveLanguageDisplay("adygey", "Адыгэбзэ").name).toBe("Адыгэбзэ")
  })

  it("trims whitespace from rawName", () => {
    expect(deriveLanguageDisplay("english", "  English  ").name).toBe("English")
  })
})

describe("deriveLanguageDisplay — missing name", () => {
  it.each([null, undefined, "", "   "])(
    "falls back to the title-cased slug for %j",
    (rawName) => {
      expect(deriveLanguageDisplay("urdu-hoda", rawName)).toEqual({
        slug: "urdu-hoda",
        name: "Urdu Hoda",
      })
    },
  )
})
