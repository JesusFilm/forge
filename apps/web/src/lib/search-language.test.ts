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
  it("does not grant alias ownership to a locale-derived public slug", () => {
    const result = buildSearchLanguageOptions({
      languages: [
        {
          id: "slugless-zh",
          coreId: "slugless-zh",
          name: { en: "Slugless Chinese metadata" },
          bcp47: "zh",
          slug: null,
        },
      ],
    })

    expect(result.options).toContainEqual(
      expect.objectContaining({
        publicSlug: "mandarin-china",
        aliasOwnerSlug: null,
      }),
    )
  })

  it("declares nativeNameLang only for a proven own-language entry (FGE-50)", () => {
    const { options } = buildSearchLanguageOptions({
      languages: [
        {
          id: "ru",
          coreId: "3934",
          name: { de: "Russisch", en: "Russian", ru: "Русский" },
          bcp47: "ru",
          slug: "russian",
        },
        {
          // Label comes from the legacy `native` key: shown, never declared.
          id: "fr",
          coreId: "496",
          name: { en: "French", native: "Français" },
          bcp47: "fr",
          slug: "french",
        },
        {
          // `ku` is Latin-script; a ku-Arab row must not show it as its own
          // name (wrong script), so the label is dropped.
          id: "ku",
          coreId: "1",
          name: { en: "Kurdish Arab Script", ku: "kurdî" },
          bcp47: "ku-Arab",
          slug: "kurdish-arab-script",
        },
      ],
    })
    const byName = new Map(options.map((o) => [o.englishName, o]))
    expect(byName.get("Russian")).toMatchObject({
      nativeName: "Русский",
      nativeNameLang: "ru",
    })
    expect(byName.get("French")?.nativeName).toBe("Français")
    expect(byName.get("French")).not.toHaveProperty("nativeNameLang")
    expect(byName.get("Kurdish Arab Script")?.nativeName).toBeNull()
    expect(byName.get("Kurdish Arab Script")).not.toHaveProperty(
      "nativeNameLang",
    )
  })

  it("drops a native name written in a different script than the language (N23)", () => {
    const { options } = buildSearchLanguageOptions({
      languages: [
        {
          id: "tg",
          coreId: "2",
          name: { en: "Tajik", tg: "تاجيكي" },
          bcp47: "tg",
          slug: "tajik",
        },
        {
          // Legacy `native` key is the same trap as the own-tag key.
          id: "mn",
          coreId: "3",
          name: { en: "Mongolian, Halh", native: "ᠮᠣᠩᠭᠣᠯ" },
          bcp47: "mn",
          slug: "mongolian-halh",
        },
        {
          // Wrong-script own-tag entry is skipped; the right-script `native`
          // label after it is still used (untagged).
          id: "tg2",
          coreId: "6",
          name: { en: "Tajik, Cyrillic", tg: "تاجيكي", native: "тоҷикӣ" },
          bcp47: "tg",
          slug: "tajik-cyrillic",
        },
        {
          id: "so",
          coreId: "4",
          name: { en: "Somali", so: "Soomaali" },
          bcp47: "so",
          slug: "somali",
        },
        {
          id: "ar",
          coreId: "5",
          name: { en: "Arabic", ar: "العربية" },
          bcp47: "ar",
          slug: "arabic",
        },
      ],
    })
    const byName = new Map(options.map((o) => [o.englishName, o]))
    expect(byName.get("Tajik")?.nativeName).toBeNull()
    expect(byName.get("Mongolian, Halh")?.nativeName).toBeNull()
    expect(byName.get("Tajik, Cyrillic")).toMatchObject({
      nativeName: "тоҷикӣ",
    })
    expect(byName.get("Tajik, Cyrillic")).not.toHaveProperty("nativeNameLang")
    expect(byName.get("Somali")?.nativeName).toBe("Soomaali")
    expect(byName.get("Arabic")?.nativeName).toBe("العربية")
  })

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
