import { describe, expect, it } from "vitest"
import {
  displayLocale,
  displayPreviewLocale,
  watchLexicalManifestQueryFields,
  watchLexicalQueryFields,
  type TypesenseWatchCatalogPreviewDocument,
} from "./typesense-watch-search-locales"

describe("displayLocale", () => {
  it("falls back title field-by-field while preserving requested description", () => {
    expect(
      displayLocale(
        {
          slug: "miraculous-catch-of-fish",
          titles: ["The Miraculous Catch of Fish"],
          localesJson: JSON.stringify([
            {
              locale: "ar",
              languageSlug: "arabic-standard",
              title: "   ",
              description: "وصف عربي",
            },
            {
              locale: "en",
              languageSlug: "english",
              title: "  The Miraculous Catch of Fish  ",
              description: "English description",
            },
          ]),
        },
        "ar",
      ),
    ).toEqual({
      locale: "ar",
      languageSlug: "arabic-standard",
      title: "The Miraculous Catch of Fish",
      description: "وصف عربي",
    })
  })

  it("humanizes the slug instead of selecting an unrelated locale", () => {
    expect(
      displayLocale(
        {
          slug: "miraculous--catch_of-fish",
          titles: ["Pêche miraculeuse"],
          localesJson: JSON.stringify([
            {
              locale: "fr",
              title: "Pêche miraculeuse",
              description: "Description française",
            },
          ]),
        },
        "ar",
      ),
    ).toEqual({
      locale: "ar",
      title: "Miraculous Catch Of Fish",
      description: null,
    })
  })

  it("accepts an English language row whose locale is not normalized to en", () => {
    expect(
      displayLocale(
        {
          slug: "miraculous-catch-of-fish",
          titles: ["The Miraculous Catch of Fish"],
          localesJson: JSON.stringify([
            {
              locale: "en-US",
              languageSlug: "english",
              title: "The Miraculous Catch of Fish",
              description: "English description",
            },
          ]),
        },
        "ar",
      ),
    ).toMatchObject({ title: "The Miraculous Catch of Fish" })
  })

  it("prefers an exact regional title over the broad language title", () => {
    const result = displayLocale(
      {
        slug: "hope-story",
        titles: ["EsperanÃ§a", "EsperanÃ§a brasileira"],
        localesJson: JSON.stringify([
          {
            locale: "pt",
            title: "EsperanÃ§a",
            description: "DescriÃ§Ã£o ampla",
          },
          {
            locale: "pt-BR",
            title: "EsperanÃ§a brasileira",
            description: "DescriÃ§Ã£o brasileira",
          },
        ]),
      },
      "pt-BR",
    )

    expect(result).toMatchObject({
      locale: "pt-BR",
      title: "EsperanÃ§a brasileira",
      description: "DescriÃ§Ã£o brasileira",
    })
  })

  it("uses a broad title for blank exact copy without replacing exact metadata", () => {
    const result = displayLocale(
      {
        slug: "hope-story",
        titles: ["EsperanÃ§a"],
        localesJson: JSON.stringify([
          {
            locale: "pt-BR",
            title: " ",
            description: "DescriÃ§Ã£o brasileira",
          },
          {
            locale: "pt",
            title: "EsperanÃ§a",
            description: "DescriÃ§Ã£o ampla",
          },
        ]),
      },
      "pt-BR",
    )

    expect(result).toMatchObject({
      locale: "pt-BR",
      title: "EsperanÃ§a",
      description: "DescriÃ§Ã£o brasileira",
    })
  })
})

function preview(
  titles: string[],
  localeCodes: string[],
): TypesenseWatchCatalogPreviewDocument {
  return {
    id: "video-1",
    titles,
    localeCodes,
    audioLanguageSlugs: [],
    subtitleLanguageSlugs: [],
  }
}

describe("displayPreviewLocale", () => {
  it.each([
    {
      name: "exact locale",
      preferredLocale: "pt-BR",
      document: preview(
        ["English", "Portugues", "Portugues do Brasil"],
        ["en", "pt", "pt-BR"],
      ),
      expected: { locale: "pt-BR", title: "Portugues do Brasil" },
    },
    {
      name: "base language",
      preferredLocale: "pt-BR",
      document: preview(["English", "Portugues"], ["en", "pt"]),
      expected: { locale: "pt", title: "Portugues" },
    },
    {
      name: "English",
      preferredLocale: "de-DE",
      document: preview(["Francais", "English"], ["fr", "en"]),
      expected: { locale: "en", title: "English" },
    },
    {
      name: "first locale",
      preferredLocale: "de-DE",
      document: preview(["Francais", "Espanol"], ["fr", "es"]),
      expected: { locale: "fr", title: "Francais" },
    },
  ])("uses the $name fallback", ({ preferredLocale, document, expected }) => {
    expect(displayPreviewLocale(document, preferredLocale)).toMatchObject(
      expected,
    )
  })

  it("uses legacy locale JSON when locale codes are not aligned", () => {
    expect(
      displayPreviewLocale(
        {
          ...preview(["English", "Francais"], ["en"]),
          localesJson: JSON.stringify([
            { locale: "en", title: "English", description: null },
            { locale: "fr", title: "Francais", description: null },
          ]),
        },
        "fr",
      ),
    ).toMatchObject({ locale: "fr", title: "Francais" })
  })
})

describe("watchLexicalQueryFields", () => {
  it.each([
    ["en", "title", ["title_en", "title_fallback"]],
    ["zh-Hans", "title", ["title_zh", "title_fallback"]],
    ["th-TH", "metadata", ["metadata_th", "metadata_fallback"]],
    ["fil", "title", ["title_fallback"]],
    ["unknown", "metadata", ["metadata_fallback"]],
  ] as const)("bounds %s %s retrieval fields", (locale, lane, expected) => {
    expect(watchLexicalQueryFields(locale, lane)).toEqual(expected)
  })

  it("uses every searchable manifest field for a candidate lane", () => {
    const fields = [
      { name: "languageIdentity", type: "string", facet: true },
      { name: "title_en", type: "string[]" },
      { name: "title_ja", type: "string[]" },
      { name: "title_zh", type: "string[]" },
      { name: "title_fallback", type: "string[]" },
      { name: "metadata_en", type: "string[]" },
      { name: "metadata_fallback", type: "string[]" },
      { name: "title_legacy", type: "string[]", index: false },
    ]

    expect(watchLexicalManifestQueryFields(fields, "title")).toEqual([
      "title_en",
      "title_ja",
      "title_zh",
      "title_fallback",
    ])
    expect(watchLexicalManifestQueryFields(fields, "metadata")).toEqual([
      "metadata_en",
      "metadata_fallback",
    ])
  })
})
