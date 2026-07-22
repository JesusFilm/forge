import { describe, expect, it } from "vitest"

import {
  buildWatchLanguageIndex,
  languageGlobeCoverage,
} from "./language-index"

describe("buildWatchLanguageIndex", () => {
  it("builds routable language rows with region groups and flag hints", () => {
    const index = buildWatchLanguageIndex({
      languages: [
        {
          id: "lang-es-419",
          coreId: "529",
          name: {
            en: "Spanish, Latin American",
            es: "Español latinoamericano",
          },
          bcp47: "es-419",
          slug: "spanish-latin-american",
        },
        {
          id: "lang-fr",
          coreId: "496",
          name: { en: "French", fr: "Français" },
          bcp47: "fr",
          slug: "french",
        },
        {
          id: "lang-unroutable",
          coreId: "hidden",
          name: { en: "No Public Route" },
          bcp47: null,
          slug: "no-public-route",
        },
      ],
      countries: [
        {
          id: "mx",
          coreId: "MX",
          name: { en: "Mexico" },
          latitude: 23.6345,
          longitude: -102.5528,
          flagPngSrc: "https://example.test/mx.png",
          continent: { id: "na", name: { en: "North America" } },
          countryLanguages: [
            {
              speakers: 80_000_000,
              primary: true,
              suggested: true,
              order: 1,
              language: {
                id: "lang-es-419",
                coreId: "529",
                name: {
                  en: "Spanish, Latin American",
                  es: "Español latinoamericano",
                },
                bcp47: "es-419",
                slug: "spanish-latin-american",
              },
            },
          ],
        },
        {
          id: "fr",
          coreId: "FR",
          name: { en: "France" },
          latitude: 46.2276,
          longitude: 2.2137,
          flagPngSrc: "https://example.test/fr.png",
          continent: { id: "eu", name: { en: "Europe" } },
          countryLanguages: [
            {
              speakers: 60_000_000,
              primary: true,
              suggested: true,
              order: 1,
              language: {
                id: "lang-fr",
                coreId: "496",
                name: { en: "French", fr: "Français" },
                bcp47: "fr",
                slug: "french",
              },
            },
          ],
        },
      ],
    })

    expect(index.languages.map((language) => language.publicSlug)).toEqual([
      "spanish-latin-american",
      "french",
    ])
    expect(
      index.languages.find(
        (language) => language.publicSlug === "spanish-latin-american",
      ),
    ).toMatchObject({
      englishLabel: "Spanish, Latin American",
      nativeLabel: "Español latinoamericano",
      href: "/spanish-latin-american.html/videos",
      flagPngSrc: "https://example.test/mx.png",
      speakerCount: 80_000_000,
      regionNames: ["North America"],
    })
    expect(index.globeLocationsByPublicSlug["spanish-latin-american"]).toEqual([
      expect.objectContaining({
        countryName: "Mexico",
        regionName: "North America",
        latitude: 23.6345,
        longitude: -102.5528,
      }),
    ])
    expect(
      index.regions.find((region) => region.name === "North America")
        ?.languages,
    ).toHaveLength(1)
    expect(
      index.regions.find((region) => region.name === "North America")
        ?.countries,
    ).toEqual([
      expect.objectContaining({
        name: "Mexico",
        flagPngSrc: "https://example.test/mx.png",
        speakerCount: 80_000_000,
        languages: [
          expect.objectContaining({
            publicSlug: "spanish-latin-american",
          }),
        ],
      }),
    ])
  })

  it("ranks valid globe locations and reports eligible regional coverage", () => {
    const language = {
      id: "lang-es-419",
      coreId: "529",
      name: { en: "Spanish", es: "Español" },
      bcp47: "es-419",
      slug: "spanish-latin-american",
    }
    const index = buildWatchLanguageIndex({
      languages: [language],
      countries: [
        {
          id: "invalid",
          name: { en: "Invalid" },
          latitude: 95,
          longitude: 0,
          continent: { name: { en: "Nowhere" } },
          countryLanguages: [
            { suggested: true, speakers: 99, order: 0, language },
          ],
        },
        {
          id: "primary",
          name: { en: "Primary" },
          latitude: 40,
          longitude: -3,
          continent: { name: { en: "Europe" } },
          countryLanguages: [
            { primary: true, speakers: 40, order: 1, language },
          ],
        },
        {
          id: "suggested",
          name: { en: "Suggested" },
          latitude: 20,
          longitude: -100,
          continent: { name: { en: "North America" } },
          countryLanguages: [
            { suggested: true, speakers: 10, order: 2, language },
          ],
        },
        {
          id: "duplicate",
          name: { en: "Duplicate" },
          latitude: 20,
          longitude: -100,
          continent: { name: { en: "North America" } },
          countryLanguages: [
            { primary: true, speakers: 1_000, order: 0, language },
          ],
        },
      ],
    })

    expect(
      index.globeLocationsByPublicSlug["spanish-latin-american"]?.map(
        (place) => place.countryName,
      ),
    ).toEqual(["Suggested", "Primary"])
    expect(languageGlobeCoverage(index)).toEqual({
      eligibleLanguages: 1,
      regions: ["Europe", "North America"],
      duplicateCoordinatePairs: 0,
    })
  })

  it("sorts country languages by parsed displaySpeakers before raw speakers", () => {
    const russian = {
      id: "lang-ru",
      coreId: "3934",
      name: { en: "Russian", ru: "Русский" },
      bcp47: "ru",
      slug: "russian",
    }
    const french = {
      id: "lang-fr",
      coreId: "496",
      name: { en: "French", fr: "Français" },
      bcp47: "fr",
      slug: "french",
    }
    const spanish = {
      id: "lang-es-419",
      coreId: "529",
      name: {
        en: "Spanish, Latin American",
        es: "Español latinoamericano",
      },
      bcp47: "es-419",
      slug: "spanish-latin-american",
    }
    const index = buildWatchLanguageIndex({
      languages: [russian, french, spanish],
      countries: [
        {
          id: "ca",
          coreId: "CA",
          name: { en: "Canada" },
          flagPngSrc: "https://example.test/ca.png",
          continent: { id: "na", name: { en: "North America" } },
          countryLanguages: [
            {
              speakers: 999_999_999,
              displaySpeakers: "5,000",
              primary: false,
              suggested: false,
              order: 1,
              language: russian,
            },
            {
              speakers: 4_000,
              displaySpeakers: "10K",
              primary: false,
              suggested: false,
              order: 2,
              language: french,
            },
            {
              speakers: 3_000,
              displaySpeakers: null,
              primary: false,
              suggested: false,
              order: 3,
              language: spanish,
            },
          ],
        },
      ],
    })

    expect(index.languages.map((language) => language.publicSlug)).toEqual([
      "french",
      "russian",
      "spanish-latin-american",
    ])
    expect(index.languages.map((language) => language.speakerCount)).toEqual([
      10_000, 5_000, 3_000,
    ])
    expect(index.regions[0]?.countries[0]).toMatchObject({
      name: "Canada",
      speakerCount: 18_000,
      languages: [
        expect.objectContaining({ publicSlug: "french" }),
        expect.objectContaining({ publicSlug: "russian" }),
        expect.objectContaining({ publicSlug: "spanish-latin-american" }),
      ],
    })
  })
})
