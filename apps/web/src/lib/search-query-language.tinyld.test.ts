import { describe, expect, it } from "vitest"

import type { SearchLanguageOption } from "./search-language"
import { detectQueryLanguageSuggestion } from "./search-query-language"

const languageOptions: SearchLanguageOption[] = [
  option("English", "english", "en"),
  option("Spanish, Castilian", "spanish-castilian", "es-ES"),
  option("Spanish, Latin American", "spanish-latin-american", "es-419"),
  option("French", "french", "fr"),
  option("Portuguese, Brazil", "portuguese-brazil", "pt-BR"),
  option("German, Standard", "german-standard", "de"),
  option("Italian", "italian", "it"),
  option("Dutch", "dutch", "nl"),
  option("Turkish", "turkish", "tr"),
  option("Indonesian", "indonesian-isa", "id"),
  option("Norwegian", "norwegian", "no"),
]

describe("detectQueryLanguageSuggestion with real TinyLD outputs", () => {
  it.each([
    "Bible stories",
    "Jesus Bible stories",
    "kids bible videos",
    "christmas story",
  ])(
    "does not suggest another language for common English query %j",
    (query) => {
      expect(
        detectQueryLanguageSuggestion({
          query,
          currentLanguageSlug: "english",
          languageOptions,
        }),
      ).toBeNull()
    },
  )

  it.each([
    ["películas bíblicas para niños cristianos", "spanish-castilian"],
    ["historias bíblicas para niños", "spanish-castilian"],
    ["histoires bibliques pour enfants", "french"],
    ["histórias bíblicas para crianças", "portuguese-brazil"],
    ["biblische geschichten fur kinder", "german-standard"],
    ["storie bibliche per bambini", "italian"],
    ["bijbelverhalen voor kinderen", "dutch"],
    ["çocuklar için incil hikayeleri", "turkish"],
    ["kisah alkitab untuk anak", "indonesian-isa"],
  ])("suggests %s as %s", (query, expectedSlug) => {
    expect(
      detectQueryLanguageSuggestion({
        query,
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: { publicSlug: expectedSlug },
      source: "tinyld",
    })
  })

  it.each(["perdón", "Navidad", "ansiedad", "hijo pródigo"])(
    "does not suggest Castilian Spanish over Latin American Spanish for %j",
    (query) => {
      expect(
        detectQueryLanguageSuggestion({
          query,
          currentLanguageSlug: "spanish-latin-american",
          languageOptions,
        }),
      ).toBeNull()
    },
  )
})

function option(
  englishName: string,
  publicSlug: string,
  bcp47: string,
): SearchLanguageOption {
  return {
    englishName,
    nativeName: null,
    bcp47,
    publicSlug,
    regionNames: [],
  }
}
