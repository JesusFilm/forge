// Golden fixture tests for Core -> Admin transforms.

import { describe, expect, it } from "vitest"
import {
  mapVideoLabel,
  mapVideoSource,
  toLocalizedNames,
  toNameMap,
  toStudyQuestions,
  toVideoLocales,
} from "./transforms"

describe("mapVideoLabel", () => {
  it.each([
    ["collection", "COLLECTION"],
    ["episode", "EPISODE"],
    ["featureFilm", "FEATURE_FILM"],
    ["segment", "SEGMENT"],
    ["series", "SERIES"],
    ["shortFilm", "SHORT_FILM"],
    ["trailer", "TRAILER"],
    ["behindTheScenes", "BEHIND_THE_SCENES"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapVideoLabel(input)).toBe(expected)
  })

  it("returns null for null and unknown input", () => {
    expect(mapVideoLabel(null)).toBeNull()
    expect(mapVideoLabel("unknownType")).toBeNull()
  })
})

describe("mapVideoSource", () => {
  it.each([
    ["internal", "INTERNAL"],
    ["youTube", "YOUTUBE"],
    ["cloudflare", "CLOUDFLARE"],
    ["mux", "MUX"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapVideoSource(input)).toBe(expected)
  })

  it("returns null for null and unknown input", () => {
    expect(mapVideoSource(null)).toBeNull()
    expect(mapVideoSource("brightcove")).toBeNull()
  })
})

describe("toNameMap", () => {
  it("converts localized values to a locale-keyed JSON map", () => {
    expect(
      toNameMap([
        { value: "English", language: { bcp47: "en" } },
        { value: "Francais", language: { bcp47: "fr" } },
      ]),
    ).toEqual({ en: "English", fr: "Francais" })
  })

  it("resolves BCP-47 from Core language ids when the payload omits bcp47", () => {
    expect(
      toNameMap([{ value: "English", language: { id: "lang-en" } }], {
        bcp47ByCoreId: new Map([["lang-en", "en"]]),
      }),
    ).toEqual({ en: "English" })
  })

  it("uses last-value-wins for duplicate locales", () => {
    expect(
      toNameMap([
        { value: "First", language: { bcp47: "en" } },
        { value: "Second", language: { bcp47: "en" } },
      ]),
    ).toEqual({ en: "Second" })
  })
})

describe("toLocalizedNames", () => {
  it("converts Core localized names to first-class locale row inputs", () => {
    expect(
      toLocalizedNames([
        { value: "Dutch", primary: false, language: { bcp47: "en" } },
        { value: "Nederlands", primary: true, language: { bcp47: "nl" } },
      ]),
    ).toEqual([
      { locale: "en", value: "Dutch", primary: false, order: null },
      { locale: "nl", value: "Nederlands", primary: true, order: null },
    ])
  })
})

describe("toVideoLocales", () => {
  it("keeps every locale as its own output row", () => {
    expect(
      toVideoLocales(
        {
          title: [
            { value: "Title", primary: true, language: { id: "lang-en" } },
            { value: "Titre", language: { id: "lang-fr" } },
          ],
          description: [{ value: "Description", language: { id: "lang-en" } }],
          snippet: [{ value: "Snippet", language: { id: "lang-en" } }],
          imageAlt: [
            { value: "Alt", language: { id: "lang-en" } },
            { value: "Alt FR", language: { id: "lang-fr" } },
          ],
        },
        {
          bcp47ByCoreId: new Map([
            ["lang-en", "en"],
            ["lang-fr", "fr"],
          ]),
        },
      ),
    ).toEqual([
      {
        locale: "en",
        title: "Title",
        description: "Description",
        snippet: "Snippet",
        imageAlt: "Alt",
        primary: true,
      },
      {
        locale: "fr",
        title: "Titre",
        description: null,
        snippet: null,
        imageAlt: "Alt FR",
        primary: false,
      },
    ])
  })
})

describe("toStudyQuestions", () => {
  it("normalizes Core study questions to per-locale row inputs", () => {
    expect(
      toStudyQuestions(
        [
          {
            id: "sq-1",
            value: "What did you learn?",
            primary: true,
            order: 1,
            language: { id: "lang-en" },
          },
        ],
        { bcp47ByCoreId: new Map([["lang-en", "en"]]) },
      ),
    ).toEqual([
      {
        coreId: "sq-1",
        locale: "en",
        languageCoreId: "lang-en",
        text: "What did you learn?",
        primary: true,
        order: 1,
      },
    ])
  })
})
