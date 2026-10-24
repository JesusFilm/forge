import { beforeAll, describe, expect, it } from "vitest"

type ScriptModule = {
  generateInventory: (args: {
    countries: string[]
    cldrData: unknown
    generatedOn: string
  }) => {
    summary: {
      countriesInput: number
      countriesMapped: number
      countriesUnmapped: number
      uniqueOfficialLanguageTags: number
    }
    languages: Array<{ tag: string }>
    unmappedCountries: Array<{ name: string; reason: string }>
  }
  normalizeLanguageTag: (tag: string) => string
  officialLanguagesForTerritory: (territory: unknown) => Array<{
    tag: string
    cldrTag: string
    officialStatus: string
    populationPercent: string | null
    writingPercent: string | null
  }>
  parseCountryCsv: (text: string) => string[]
  resolveCountryCode: (
    countryName: string,
    territoryInfo: unknown,
  ) => string | null
}

let generateInventory: ScriptModule["generateInventory"]
let normalizeLanguageTag: ScriptModule["normalizeLanguageTag"]
let officialLanguagesForTerritory: ScriptModule["officialLanguagesForTerritory"]
let parseCountryCsv: ScriptModule["parseCountryCsv"]
let resolveCountryCode: ScriptModule["resolveCountryCode"]

beforeAll(async () => {
  const script = (await import(
    // @ts-expect-error TS7016: this test intentionally exercises the Node ESM script.
    "../../../scripts/watch-ui-official-languages.mjs"
  )) as ScriptModule

  generateInventory = script.generateInventory
  normalizeLanguageTag = script.normalizeLanguageTag
  officialLanguagesForTerritory = script.officialLanguagesForTerritory
  parseCountryCsv = script.parseCountryCsv
  resolveCountryCode = script.resolveCountryCode
})

const cldrFixture = {
  supplemental: {
    version: {
      _cldrVersion: "48",
      _unicodeVersion: "16.0.0",
    },
    territoryInfo: {
      BD: {
        languagePopulation: {
          bn: {
            _officialStatus: "official",
            _populationPercent: "99",
          },
          en: {
            _populationPercent: "12",
          },
        },
      },
      HK: {
        languagePopulation: {
          yue_Hant: {
            _officialStatus: "de_facto_official",
            _populationPercent: "88",
          },
        },
      },
    },
  },
}

describe("watch UI official-language inventory", () => {
  it("parses the sanitized one-column country CSV", () => {
    expect(
      parseCountryCsv("Country\nBangladesh\nBangladesh\nHong Kong\n"),
    ).toEqual(["Bangladesh", "Hong Kong"])
  })

  it("normalizes CLDR language tags into BCP-47-like tags", () => {
    expect(normalizeLanguageTag("yue_Hant")).toBe("yue-Hant")
    expect(normalizeLanguageTag("pt_PT")).toBe("pt-PT")
  })

  it("filters to official and national status languages", () => {
    expect(
      officialLanguagesForTerritory(cldrFixture.supplemental.territoryInfo.BD),
    ).toEqual([
      {
        tag: "bn",
        cldrTag: "bn",
        officialStatus: "official",
        populationPercent: "99",
        writingPercent: null,
      },
    ])
  })

  it("resolves GA country display aliases against CLDR territory codes", () => {
    expect(
      resolveCountryCode("Hong Kong", cldrFixture.supplemental.territoryInfo),
    ).toBe("HK")
  })

  it("records unmapped countries instead of dropping them silently", () => {
    const inventory = generateInventory({
      countries: ["Bangladesh", "Hong Kong", "(not set)"],
      cldrData: cldrFixture,
      generatedOn: "2026-06-02",
    })

    expect(inventory.summary).toEqual({
      countriesInput: 3,
      countriesMapped: 2,
      countriesUnmapped: 1,
      uniqueOfficialLanguageTags: 2,
    })
    expect(
      inventory.languages.map((language: { tag: string }) => language.tag),
    ).toEqual(["bn", "yue-Hant"])
    expect(inventory.unmappedCountries).toEqual([
      {
        name: "(not set)",
        reason: "No CLDR territory code mapping",
      },
    ])
  })
})
