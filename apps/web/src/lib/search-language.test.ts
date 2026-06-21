import { describe, expect, it } from "vitest"

import {
  buildSearchLanguageOptions,
  groupSearchLanguagesByRegion,
  normalizeSearchLanguageName,
  resolveSearchLanguage,
  stripLanguageFromSearchQuery,
  type SearchLanguageOption,
} from "./search-language"

const languageOptions: SearchLanguageOption[] = [
  {
    englishName: "English",
    nativeName: "English",
    bcp47: "en",
    publicSlug: "english",
    regionNames: ["North America", "Europe"],
  },
  {
    englishName: "Spanish, Castilian",
    nativeName: "Español",
    bcp47: "es-ES",
    publicSlug: "spanish-castilian",
    regionNames: ["Europe", "South America"],
  },
  {
    englishName: "French",
    nativeName: "Français",
    bcp47: "fr",
    publicSlug: "french",
    regionNames: ["Europe", "Africa"],
  },
]

describe("normalizeSearchLanguageName", () => {
  it("matches Core's comma-insensitive language normalization", () => {
    expect(normalizeSearchLanguageName(" Spanish, Castilian ")).toBe(
      "spanish castilian",
    )
  })
})

describe("stripLanguageFromSearchQuery", () => {
  it("strips the leading Core language token from the query", () => {
    expect(
      stripLanguageFromSearchQuery("Spanish, Latin American", "jesus spanish"),
    ).toBe("jesus")
  })

  it("keeps unrelated query text unchanged", () => {
    expect(stripLanguageFromSearchQuery("Spanish", "love spain")).toBe(
      "love spain",
    )
  })
})

describe("resolveSearchLanguage", () => {
  it("uses explicit public slugs before legacy selected English names", () => {
    expect(
      resolveSearchLanguage({
        selectedEnglishNames: ["Spanish Castilian"],
        explicitSlug: "french",
        languageOptions,
      }),
    ).toEqual({
      locale: "fr",
      publicSlug: "french",
      englishName: "French",
      source: "explicit-selection",
    })
  })

  it("uses selected language names before route and browser defaults", () => {
    expect(
      resolveSearchLanguage({
        selectedEnglishNames: ["Spanish Castilian"],
        routeLanguageSlug: "french",
        acceptLanguage: "en-US,en;q=0.9",
        languageOptions,
      }),
    ).toEqual({
      locale: "es",
      publicSlug: "spanish-castilian",
      englishName: "Spanish, Castilian",
      source: "explicit-selection",
    })
  })

  it("uses route language before browser Accept-Language", () => {
    expect(
      resolveSearchLanguage({
        routeLanguageSlug: "french",
        acceptLanguage: "es-419,es;q=0.9,en;q=0.8",
        languageOptions,
      }),
    ).toMatchObject({
      locale: "fr",
      publicSlug: "french",
      source: "route",
    })
  })

  it("falls back from browser language to a public audio slug", () => {
    expect(
      resolveSearchLanguage({
        acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8",
        languageOptions,
      }),
    ).toMatchObject({
      locale: "pt",
      publicSlug: "portuguese-brazil",
      source: "accept-language",
    })
  })

  it("falls back safely to English for unsupported languages", () => {
    expect(
      resolveSearchLanguage({
        acceptLanguage: "aiw-ET,aiw;q=0.9",
        languageOptions,
      }),
    ).toEqual({
      locale: "en",
      publicSlug: "english",
      englishName: "English",
      source: "fallback",
    })
  })
})

describe("groupSearchLanguagesByRegion", () => {
  it("groups language options by regions without treating regions as selections", () => {
    expect(groupSearchLanguagesByRegion(languageOptions)).toEqual([
      {
        regionName: "Africa",
        languages: [languageOptions[2]],
      },
      {
        regionName: "Europe",
        languages: [languageOptions[0], languageOptions[2], languageOptions[1]],
      },
      {
        regionName: "North America",
        languages: [languageOptions[0]],
      },
      {
        regionName: "South America",
        languages: [languageOptions[1]],
      },
    ])
  })
})

describe("buildSearchLanguageOptions", () => {
  it("builds facet-limited language options grouped from country metadata", () => {
    const result = buildSearchLanguageOptions({
      availableLanguageFacets: {
        English: 10,
        "Spanish, Castilian": 5,
      },
      countryCode: "US",
      countryName: "United States",
      languages: [
        {
          id: "language-1",
          coreId: "529",
          name: { en: "English" },
          bcp47: "en",
          slug: "english",
        },
        {
          id: "language-2",
          coreId: "21028",
          name: { en: "Spanish, Castilian", es: "Español" },
          bcp47: "es-ES",
          slug: "spanish-castilian",
        },
        {
          id: "language-3",
          coreId: "496",
          name: { en: "French" },
          bcp47: "fr",
          slug: "french",
        },
      ],
      countries: [
        {
          coreId: "US",
          name: { en: "United States" },
          flagPngSrc: "https://example.test/us.png",
          continent: { name: { en: "North America" } },
          countryLanguages: [
            {
              speakers: 300,
              primary: true,
              suggested: true,
              language: {
                id: "language-1",
                coreId: "529",
                name: { en: "English" },
                bcp47: "en",
                slug: "english",
              },
            },
            {
              speakers: 100,
              language: {
                id: "language-2",
                coreId: "21028",
                name: { en: "Spanish, Castilian" },
                bcp47: "es-ES",
                slug: "spanish-castilian",
              },
            },
          ],
        },
      ],
    })

    expect(result.options).toMatchObject([
      {
        englishName: "English",
        publicSlug: "english",
        regionNames: ["North America"],
        facetCount: 10,
      },
      {
        englishName: "Spanish, Castilian",
        publicSlug: "spanish-castilian",
        regionNames: ["North America"],
        facetCount: 5,
      },
    ])
    expect(result.countrySuggestion).toMatchObject({
      countryName: "United States",
      flagPngSrc: "https://example.test/us.png",
      languages: [
        { englishName: "English" },
        { englishName: "Spanish, Castilian" },
      ],
    })
  })
})
