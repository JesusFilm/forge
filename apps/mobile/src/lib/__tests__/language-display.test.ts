import { deriveLanguageDisplay } from "../language-display"

describe("deriveLanguageDisplay", () => {
  it("title-cases the slug when there is no name (the last fallback)", () => {
    expect(deriveLanguageDisplay("spanish-latin-american", null)).toEqual({
      slug: "spanish-latin-american",
      name: "Spanish Latin American",
      nativeName: null,
    })
  })

  it("keeps an English name as the name", () => {
    expect(deriveLanguageDisplay("russian", "Russian").name).toBe("Russian")
  })

  it("keeps the English slug name beside a native-script name", () => {
    expect(deriveLanguageDisplay("russian", "Русский")).toEqual({
      slug: "russian",
      name: "Russian",
      nativeName: "Русский",
    })
  })

  // R9 (U7): a name in the UI language is the name the viewer reads, even in
  // a script the English-or-native check would call native.
  it("uses a name in the UI language as the name", () => {
    expect(
      deriveLanguageDisplay("russian", "русский", { inUiLanguage: true }),
    ).toEqual({ slug: "russian", name: "русский", nativeName: null })
  })

  it("still title-cases the slug when a UI-language name is blank", () => {
    expect(
      deriveLanguageDisplay("hausa", "  ", { inUiLanguage: true }).name,
    ).toBe("Hausa")
  })
})
