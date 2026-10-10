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
