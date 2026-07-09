import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchLanguageOption } from "./search-language"

const detectAllMock = vi.hoisted(() => vi.fn())

vi.mock("tinyld", () => ({
  detectAll: detectAllMock,
}))

import {
  detectQueryLanguageSuggestion,
  findSearchLanguageOptionForDetectorCode,
} from "./search-query-language"

const english = option("English", "english", "en")
const spanish = option("Spanish, Castilian", "spanish-castilian", "es-ES")
const french = option("French", "french", "fr")
const norwegian = option("Norwegian", "norwegian", "no")
const arabic = option("Arabic, Modern Standard", "arabic-modern-standard", "ar")
const hindi = option("Hindi", "hindi", "hi")
const japanese = option("Japanese", "japanese", "ja")

const languageOptions = [
  english,
  spanish,
  french,
  norwegian,
  arabic,
  hindi,
  japanese,
]

describe("detectQueryLanguageSuggestion", () => {
  beforeEach(() => {
    detectAllMock.mockReset()
  })

  it("suggests a supported language when TinyLD has enough confidence", () => {
    detectAllMock.mockReturnValue([
      { lang: "es", accuracy: 0.4 },
      { lang: "pt", accuracy: 0.12 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "peliculas biblicas para ninos cristianos",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: spanish,
      source: "tinyld",
      confidence: 0.4,
      margin: 0.28,
    })
  })

  it("does not call the detector for one-character Latin queries", () => {
    expect(
      detectQueryLanguageSuggestion({
        query: "j",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toBeNull()
    expect(detectAllMock).not.toHaveBeenCalled()
  })

  it("rejects short Latin queries when the detector cannot clearly identify one", () => {
    detectAllMock.mockReturnValue([
      { lang: "es", accuracy: 0.25 },
      { lang: "pt", accuracy: 0.23 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "vida",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toBeNull()
  })

  it("suggests a language for short distinctive Latin queries", () => {
    detectAllMock.mockReturnValue([{ lang: "es", accuracy: 1 }])

    expect(
      detectQueryLanguageSuggestion({
        query: "niños",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: spanish,
      source: "tinyld",
    })
  })

  it("does not suggest the currently selected search language", () => {
    detectAllMock.mockReturnValue([
      { lang: "es", accuracy: 0.9 },
      { lang: "fr", accuracy: 0.1 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "peliculas biblicas para ninos cristianos",
        currentLanguageSlug: "spanish-castilian",
        languageOptions,
      }),
    ).toBeNull()
  })

  it("rejects low-confidence detector calls even when the top language is supported", () => {
    detectAllMock.mockReturnValue([
      { lang: "es", accuracy: 0.09 },
      { lang: "pt", accuracy: 0.08 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "videos de esperanza para jovenes cristianos",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toBeNull()
  })

  it("does not suggest Norwegian for TinyLD's low-confidence Bible stories guess", () => {
    detectAllMock.mockReturnValue([
      { lang: "no", accuracy: 0.12975 },
      { lang: "da", accuracy: 0.09140833333333333 },
      { lang: "fr", accuracy: 0.08333333333333333 },
      { lang: "en", accuracy: 0.07800833333333333 },
      { lang: "sv", accuracy: 0.06274166666666667 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "Bible stories",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toBeNull()
  })

  it("rejects unsupported top language guesses", () => {
    detectAllMock.mockReturnValue([
      { lang: "ga", accuracy: 0.9 },
      { lang: "en", accuracy: 0.1 },
    ])

    expect(
      detectQueryLanguageSuggestion({
        query: "long enough query text with enough language tokens",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toBeNull()
  })

  it("uses script hints for unambiguous non-Latin scripts", () => {
    expect(
      detectQueryLanguageSuggestion({
        query: "يسوع",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: arabic,
      source: "script",
    })
    expect(detectAllMock).not.toHaveBeenCalled()
  })

  it("uses script hints for short Devanagari queries", () => {
    expect(
      detectQueryLanguageSuggestion({
        query: "य",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: hindi,
      source: "script",
    })
    expect(detectAllMock).not.toHaveBeenCalled()
  })

  it("uses script hints for a single Japanese kana character", () => {
    expect(
      detectQueryLanguageSuggestion({
        query: "あ",
        currentLanguageSlug: "english",
        languageOptions,
      }),
    ).toMatchObject({
      option: japanese,
      source: "script",
    })
    expect(detectAllMock).not.toHaveBeenCalled()
  })
})

describe("findSearchLanguageOptionForDetectorCode", () => {
  it("prefers the public Watch slug for codes with multiple variants", () => {
    const latinAmericanSpanish = option(
      "Spanish, Latin American",
      "spanish-latin-american",
      "es-419",
    )

    expect(
      findSearchLanguageOptionForDetectorCode("es", [
        latinAmericanSpanish,
        spanish,
      ]),
    ).toBe(spanish)
  })

  it("does not guess when BCP-47 fallback has multiple matches", () => {
    const first = option("First", "first", "zz-AA")
    const second = option("Second", "second", "zz-BB")

    expect(findSearchLanguageOptionForDetectorCode("zz", [first, second])).toBe(
      null,
    )
  })
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
