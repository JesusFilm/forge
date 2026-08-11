import { describe, expect, it } from "vitest"
import {
  displayPreviewLocale,
  watchLexicalManifestQueryFields,
  watchLexicalQueryFields,
  type TypesenseWatchCatalogPreviewDocument,
} from "./typesense-watch-search-locales"

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
