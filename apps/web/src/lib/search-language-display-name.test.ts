import { describe, expect, it, vi } from "vitest"

import { localizedSearchLanguageName } from "./search-language-display-name"

const russian = {
  englishName: "Russian",
  nativeName: "Русский",
  bcp47: "ru",
  publicSlug: "russian",
  regionNames: [],
}

describe("localizedSearchLanguageName", () => {
  it("preserves a provider-owned catalog qualifier that ICU drops", () => {
    const africanFrench = {
      ...russian,
      englishName: "French, African",
      nativeName: null,
      bcp47: "fra",
      publicSlug: "french-african",
    }
    for (const locale of ["fr", "en", "es", "ru", "zh"]) {
      expect(
        localizedSearchLanguageName(
          africanFrench,
          locale,
          "Language",
          "catalog-identity",
        ),
      ).toBe("French, African")
    }
    // Search retains its previous behavior; the recovery usage is opt-in.
    expect(localizedSearchLanguageName(africanFrench, "fr", "Language")).toBe(
      "français",
    )
  })

  // Only an ICU-ALIASED tag (fra -> fr) loses its provider qualifier. These
  // rows have a qualifier or a synonym in the provider's English name but an
  // un-aliased tag, or a synonym-only name, so each must keep localizing.
  it.each([
    ["German, Standard", "de", "ru", "немецкий"],
    ["Spanish, Castilian", "es-ES", "ru", "европейский испанский"],
    ["Portuguese, Brazil", "pt", "ru", "португальский"],
    ["Chinese, Mandarin", "zh", "ru", "китайский"],
    ["Adygey", "ady", "ru", "адыгейский"],
    // Aliased tag (bel -> be) but a pure synonym, not ICU's name plus a qualifier.
    ["Belorussian", "bel", "ru", "белорусский"],
  ])(
    "keeps localizing %s (%s) for %s UI",
    (englishName, bcp47, locale, expected) => {
      expect(
        localizedSearchLanguageName(
          { ...russian, englishName, nativeName: null, bcp47 },
          locale,
          "Language",
          "catalog-identity",
        ),
      ).toBe(expected)
    },
  )

  it("keeps a provider qualifier whenever ICU aliases the tag, not only for French", () => {
    expect(
      localizedSearchLanguageName(
        {
          ...russian,
          englishName: "English, British",
          nativeName: null,
          bcp47: "eng",
        },
        "ru",
        "Language",
        "catalog-identity",
      ),
    ).toBe("English, British")
  })

  it("still localizes plain French and fully represented regional names", () => {
    expect(
      localizedSearchLanguageName(
        { ...russian, englishName: "French", bcp47: "fr" },
        "fr",
        "Language",
        "catalog-identity",
      ),
    ).toBe("français")
    expect(
      localizedSearchLanguageName(
        { ...russian, englishName: "Brazilian Portuguese", bcp47: "pt-BR" },
        "ru",
        "Language",
        "catalog-identity",
      ),
    ).toBe("бразильский португальский")
  })

  it("uses the interface-localized language name when supported", () => {
    expect(localizedSearchLanguageName(russian, "ru", "Язык поиска")).toBe(
      "русский",
    )
  })

  it("uses a natural Russian prepositional form inside search sentences", () => {
    expect(
      localizedSearchLanguageName(
        russian,
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("русском")

    expect(
      localizedSearchLanguageName(
        { ...russian, bcp47: "en", englishName: "English" },
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("английском")
  })

  it("keeps indeclinable Russian language names unchanged", () => {
    expect(
      localizedSearchLanguageName(
        { ...russian, bcp47: "hi", englishName: "Hindi" },
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("хинди")
  })

  it("inflects every relevant word in compound Russian language names", () => {
    expect(
      localizedSearchLanguageName(
        { ...russian, bcp47: "pt-BR", englishName: "Brazilian Portuguese" },
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("бразильском португальском")

    expect(
      localizedSearchLanguageName(
        { ...russian, bcp47: "zh-Hans", englishName: "Simplified Chinese" },
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("китайском, упрощенном письме")
  })

  it("rejects silent interface-locale fallback and uses the native name", () => {
    const displayNames = vi.spyOn(Intl, "DisplayNames").mockImplementation(
      () =>
        ({
          of: () => "Russian",
          resolvedOptions: () => ({ locale: "en-US" }),
        }) as unknown as Intl.DisplayNames,
    )

    expect(localizedSearchLanguageName(russian, "tvl", "Language")).toBe(
      "Русский",
    )
    displayNames.mockRestore()
  })

  it("rejects code-like successful results", () => {
    const displayNames = vi.spyOn(Intl, "DisplayNames").mockImplementation(
      () =>
        ({
          of: () => "mey (Latin)",
          resolvedOptions: () => ({ locale: "en-US" }),
        }) as unknown as Intl.DisplayNames,
    )
    const option = { ...russian, bcp47: "mey-Latn", nativeName: "حسانية" }

    expect(localizedSearchLanguageName(option, "en", "Language")).toBe("حسانية")
    displayNames.mockRestore()
  })

  it("does not apply Russian inflection to a non-Cyrillic fallback name", () => {
    const displayNames = vi.spyOn(Intl, "DisplayNames").mockImplementation(
      () =>
        ({
          of: () => "mey (Latin)",
          resolvedOptions: () => ({ locale: "en-US" }),
        }) as unknown as Intl.DisplayNames,
    )
    const option = { ...russian, bcp47: "mey-Latn", nativeName: "حسانية" }

    expect(
      localizedSearchLanguageName(
        option,
        "ru",
        "Язык поиска",
        "search-prepositional",
      ),
    ).toBe("حسانية")
    displayNames.mockRestore()
  })
})
