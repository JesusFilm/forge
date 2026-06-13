import { describe, expect, it } from "vitest"
import {
  deriveEnrichLanguagePlan,
  deriveSourceLanguage,
  resolveTargetLanguageCodes,
} from "@/lib/enrich-language"

describe("enrich language contract", () => {
  it("prefers the video's primary language as the source language", () => {
    expect(
      deriveSourceLanguage({
        primaryLanguage: {
          coreId: "529",
          bcp47: "en-US",
          iso3: "eng",
        },
        variants: [
          {
            aiGenerated: false,
            language: { coreId: "3934", bcp47: "ru-RU", iso3: "rus" },
          },
        ],
      }),
    ).toEqual({
      coreId: "529",
      bcp47: "en-US",
      iso3: "eng",
    })
  })

  it("falls back to the first non-ai variant language when primary language is missing", () => {
    expect(
      deriveSourceLanguage({
        variants: [
          {
            aiGenerated: true,
            language: { coreId: "20526", bcp47: "fr-FR", iso3: "fra" },
          },
          {
            aiGenerated: false,
            language: { coreId: "3934", bcp47: "ru-RU", iso3: "rus" },
          },
        ],
      }),
    ).toEqual({
      coreId: "3934",
      bcp47: "ru-RU",
      iso3: "rus",
    })
  })

  it("resolves selected target language ids to stable language codes", () => {
    const languagesById = new Map([
      ["3934", { coreId: "3934", bcp47: "ru-RU", iso3: "rus" }],
      ["529", { coreId: "529", bcp47: "en-US", iso3: "eng" }],
      ["6414", { coreId: "6414", bcp47: "fr-FR", iso3: "fra" }],
    ])

    expect(
      resolveTargetLanguageCodes(["3934", "6414", "3934"], languagesById),
    ).toEqual({
      codes: ["ru", "fr"],
      unresolvedIds: [],
    })
  })

  it("returns unresolved ids when a target language cannot be normalized safely", () => {
    const languagesById = new Map([
      ["3934", { coreId: "3934", bcp47: null, iso3: null }],
    ])

    expect(resolveTargetLanguageCodes(["3934"], languagesById)).toEqual({
      codes: [],
      unresolvedIds: ["3934"],
    })
  })

  it("does not treat unknown Admin IDs as raw language codes", () => {
    expect(
      resolveTargetLanguageCodes(["cmokkxw5v03uyqsccis58pea6"], new Map()),
    ).toEqual({
      codes: [],
      unresolvedIds: ["cmokkxw5v03uyqsccis58pea6"],
    })
  })

  it("still accepts explicit raw BCP-47 language tags", () => {
    expect(resolveTargetLanguageCodes(["pt-BR"], new Map())).toEqual({
      codes: ["pt"],
      unresolvedIds: [],
    })
  })

  it("builds an enrich plan with source and target concerns separated", () => {
    const languagesById = new Map([
      ["6414", { coreId: "6414", bcp47: "fr-FR", iso3: "fra" }],
      ["529", { coreId: "529", bcp47: "en-US", iso3: "eng" }],
    ])

    expect(
      deriveEnrichLanguagePlan(
        {
          primaryLanguage: {
            coreId: "3934",
            bcp47: "ru-RU",
            iso3: "rus",
          },
          variants: [
            {
              aiGenerated: false,
              language: { coreId: "3934", bcp47: "ru-RU", iso3: "rus" },
            },
          ],
        },
        ["6414", "529"],
        languagesById,
      ),
    ).toEqual({
      sourceLanguage: {
        coreId: "3934",
        bcp47: "ru-RU",
        iso3: "rus",
      },
      sourceLanguageCode: "ru",
      muxSubtitleLanguageCode: "ru",
      targetLanguageCodes: ["fr", "en"],
      unresolvedTargetLanguageIds: [],
    })
  })
})
