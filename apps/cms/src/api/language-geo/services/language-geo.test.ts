import { describe, expect, it, vi } from "vitest"
import { queryLanguageGeo } from "./language-geo"

describe("queryLanguageGeo", () => {
  it("derives English language labels while preserving native labels", async () => {
    const knex = {
      raw: vi.fn(async () => ({
        rows: [
          {
            lang_core_id: "ar",
            lang_document_id: "lang-ar",
            lang_name: "اللغة العربية",
            lang_bcp_47: "ar",
            lang_iso_3: "ara",
            speakers: 120,
            country_core_id: "ae",
            country_document_id: "country-ae",
            country_name: "United Arab Emirates",
            continent_core_id: "asia",
            continent_document_id: "continent-asia",
            continent_name: "Asia",
          },
          {
            lang_core_id: "ru",
            lang_document_id: "lang-ru",
            lang_name: "русский",
            lang_bcp_47: "ru",
            lang_iso_3: "rus",
            speakers: 80,
            country_core_id: "ru",
            country_document_id: "country-ru",
            country_name: "Russia",
            continent_core_id: "europe",
            continent_document_id: "continent-europe",
            continent_name: "Europe",
          },
        ],
      })),
    }

    const result = await queryLanguageGeo(knex)

    expect(result.languages).toEqual([
      expect.objectContaining({
        bcp47: "ar",
        id: "ar",
        iso3: "ara",
        englishLabel: "Arabic",
        nativeLabel: "اللغة العربية",
      }),
      expect.objectContaining({
        bcp47: "ru",
        id: "ru",
        iso3: "rus",
        englishLabel: "Russian",
        nativeLabel: "русский",
      }),
    ])
  })

  it("falls back to the stored label for language codes Intl cannot name", async () => {
    const knex = {
      raw: vi.fn(async () => ({
        rows: [
          {
            lang_core_id: "aari",
            lang_document_id: "lang-aari",
            lang_name: "Aari",
            lang_bcp_47: "aari",
            lang_iso_3: null,
            speakers: 10,
            country_core_id: "et",
            country_document_id: "country-et",
            country_name: "Ethiopia",
            continent_core_id: "africa",
            continent_document_id: "continent-africa",
            continent_name: "Africa",
          },
        ],
      })),
    }

    const result = await queryLanguageGeo(knex)

    expect(result.languages[0]).toEqual(
      expect.objectContaining({
        englishLabel: "Aari",
        nativeLabel: "Aari",
      }),
    )
  })
})
