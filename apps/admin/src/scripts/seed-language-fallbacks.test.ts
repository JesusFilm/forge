import { describe, expect, it } from "vitest"

import {
  buildLanguageFallbackCandidates,
  parseArgs,
  type CountryLanguageSeedRow,
  type LanguageSeedRow,
} from "./seed-language-fallbacks"

const languages: LanguageSeedRow[] = [
  {
    id: "lang-es",
    slug: "spanish-castilian",
    bcp47: "es",
    iso3: "spa",
    englishName: "Spanish",
  },
  {
    id: "lang-es-419",
    slug: "spanish-latin-american",
    bcp47: "es-419",
    iso3: "spa",
    englishName: "Latin American Spanish",
  },
  {
    id: "lang-en",
    slug: "english",
    bcp47: "en",
    iso3: "eng",
    englishName: "English",
  },
  {
    id: "lang-small",
    slug: "small-language",
    bcp47: "x-small",
    iso3: "sma",
    englishName: "Small Language",
  },
]

function countryLanguage(
  overrides: Partial<CountryLanguageSeedRow>,
): CountryLanguageSeedRow {
  return {
    countryId: "country-1",
    countryName: "Exampleland",
    countryPopulation: 1_000_000,
    countryLanguageRows: 3,
    languageId: "lang-small",
    speakers: 10_000,
    primary: false,
    suggested: false,
    order: null,
    ...overrides,
  }
}

describe("seed-language-fallbacks", () => {
  it("parses dry-run arguments with defaults", () => {
    expect(parseArgs([])).toEqual({
      execute: false,
      verbose: false,
      maxPerLanguage: 5,
      minScore: 0.35,
      sourceLanguageSlug: undefined,
      limit: undefined,
    })
  })

  it("prioritizes same BCP-47 base variants over country-only matches", () => {
    const candidates = buildLanguageFallbackCandidates({
      languages,
      countryLanguages: [
        countryLanguage({ languageId: "lang-es", speakers: 400_000 }),
        countryLanguage({
          languageId: "lang-en",
          speakers: 800_000,
          primary: true,
        }),
      ],
      playableDubCounts: new Map([
        ["lang-es-419", 20],
        ["lang-en", 2_000],
      ]),
      maxPerLanguage: 2,
      minScore: 0.1,
    })

    expect(
      candidates.filter((row) => row.sourceLanguageId === "lang-es"),
    ).toMatchObject([
      {
        fallbackLanguageId: "lang-es-419",
        priority: 1,
      },
      {
        fallbackLanguageId: "lang-en",
        priority: 2,
      },
    ])
  })

  it("does not produce fallbacks without playable media", () => {
    const candidates = buildLanguageFallbackCandidates({
      languages,
      countryLanguages: [
        countryLanguage({ languageId: "lang-small", speakers: 20_000 }),
        countryLanguage({
          languageId: "lang-en",
          speakers: 900_000,
          primary: true,
        }),
      ],
      playableDubCounts: new Map(),
      minScore: 0.1,
    })

    expect(candidates).toEqual([])
  })

  it("keeps only the configured number of fallbacks per source language", () => {
    const candidates = buildLanguageFallbackCandidates({
      languages,
      countryLanguages: [
        countryLanguage({ languageId: "lang-small", speakers: 20_000 }),
        countryLanguage({
          languageId: "lang-en",
          speakers: 900_000,
          primary: true,
        }),
        countryLanguage({
          languageId: "lang-es",
          speakers: 700_000,
          suggested: true,
        }),
      ],
      playableDubCounts: new Map([
        ["lang-en", 2_000],
        ["lang-es", 400],
      ]),
      maxPerLanguage: 1,
      minScore: 0.1,
    })

    expect(
      candidates.filter((row) => row.sourceLanguageId === "lang-small"),
    ).toHaveLength(1)
  })
})
