import { describe, expect, it } from "vitest"

import { buildWatchLanguageIndex } from "./language-index"

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
})
