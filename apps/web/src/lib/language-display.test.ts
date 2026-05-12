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

describe("deriveLanguageDisplay", () => {
  it("returns null nativeName when rawName matches the slug-derived English", () => {
    expect(deriveLanguageDisplay("english", "English")).toEqual({
      slug: "english",
      name: "English",
      nativeName: null,
    })
  })

  it("returns null nativeName when rawName matches case-insensitively", () => {
    expect(deriveLanguageDisplay("english", "english")).toEqual({
      slug: "english",
      name: "English",
      nativeName: null,
    })
  })

  it("treats commas and punctuation as equivalent during the equality check", () => {
    // Strapi sometimes stores 'Arabic, Sudanese Spoken' for slug
    // 'arabic-sudanese-spoken'. We don't want a near-duplicate subtitle.
    expect(
      deriveLanguageDisplay(
        "arabic-sudanese-spoken",
        "Arabic, Sudanese Spoken",
      ),
    ).toEqual({
      slug: "arabic-sudanese-spoken",
      name: "Arabic Sudanese Spoken",
      nativeName: null,
    })
  })

  it("surfaces the native form when the script differs", () => {
    expect(deriveLanguageDisplay("french", "Français")).toEqual({
      slug: "french",
      name: "French",
      nativeName: "Français",
    })
    expect(
      deriveLanguageDisplay("arabic-modern-standard", "اللغة العربية"),
    ).toEqual({
      slug: "arabic-modern-standard",
      name: "Arabic Modern Standard",
      nativeName: "اللغة العربية",
    })
  })

  it("trims whitespace from rawName before comparing", () => {
    expect(deriveLanguageDisplay("english", "  English  ")).toEqual({
      slug: "english",
      name: "English",
      nativeName: null,
    })
  })

  it("returns null nativeName when rawName is null/undefined/empty", () => {
    expect(deriveLanguageDisplay("english", null).nativeName).toBeNull()
    expect(deriveLanguageDisplay("english", undefined).nativeName).toBeNull()
    expect(deriveLanguageDisplay("english", "").nativeName).toBeNull()
    expect(deriveLanguageDisplay("english", "   ").nativeName).toBeNull()
  })
})
