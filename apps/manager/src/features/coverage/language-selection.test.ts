import { describe, expect, it } from "vitest"

import {
  hasSelectedLanguages,
  normalizeCoverageLanguageSearchParams,
  parseRequestedLanguageIds,
  resolveLanguagePresets,
  resolveRequestedLanguageIds,
  type LanguageOption,
} from "@/features/coverage/language-selection"

describe("language-selection", () => {
  it("treats an empty language selection as the empty state trigger", () => {
    expect(hasSelectedLanguages([])).toBe(false)
    expect(hasSelectedLanguages(["lang-en"])).toBe(true)
  })

  it("resolves the coverage language presets from available languages", () => {
    const languages: LanguageOption[] = [
      { id: "lang-ar", englishLabel: "Arabic", nativeLabel: "العربية" },
      { id: "lang-en", englishLabel: "English", nativeLabel: "English" },
      { id: "lang-es", englishLabel: "Spanish", nativeLabel: "Español" },
      { id: "lang-fr", englishLabel: "French", nativeLabel: "Français" },
      { id: "lang-pt", englishLabel: "Portuguese", nativeLabel: "Português" },
    ]

    expect(resolveLanguagePresets(languages)).toEqual([
      { id: "lang-en", label: "English" },
      { id: "lang-fr", label: "French" },
      { id: "lang-es", label: "Spanish" },
      { id: "lang-ar", label: "Modern Standard Arabic" },
    ])
  })

  it("skips presets that are not present in the fetched language catalog", () => {
    const languages: LanguageOption[] = [
      { id: "lang-en", englishLabel: "English", nativeLabel: "English" },
      { id: "lang-sw", englishLabel: "Swahili", nativeLabel: "Kiswahili" },
    ]

    expect(resolveLanguagePresets(languages)).toEqual([
      { id: "lang-en", label: "English" },
    ])
  })

  it("parses and deduplicates requested language ids", () => {
    expect(parseRequestedLanguageIds(" lang-en,lang-fr,lang-en ,, ")).toEqual([
      "lang-en",
      "lang-fr",
    ])
  })

  it("prefers the canonical languageId param while still supporting legacy languageIds", () => {
    expect(
      resolveRequestedLanguageIds({
        languageId: "lang-es",
        languageIds: "lang-fr,lang-ar",
      }),
    ).toEqual(["lang-es"])

    expect(
      resolveRequestedLanguageIds({
        languageIds: "lang-fr,lang-ar",
      }),
    ).toEqual(["lang-fr", "lang-ar"])
  })

  it("normalizes coverage language query params to the canonical singular key", () => {
    const normalized = normalizeCoverageLanguageSearchParams(
      "origin=collection&refresh=1&languageIds=lang-fr&languageId=lang-ar",
      ["lang-en", "lang-es"],
    )

    expect(normalized.get("origin")).toBe("collection")
    expect(normalized.get("refresh")).toBeNull()
    expect(normalized.get("languageIds")).toBeNull()
    expect(normalized.get("languageId")).toBe("lang-en,lang-es")
  })

  it("removes both language query keys when the selection is cleared", () => {
    const normalized = normalizeCoverageLanguageSearchParams(
      "languageIds=lang-fr&languageId=lang-ar&mediaType=series",
      [],
    )

    expect(normalized.get("mediaType")).toBe("series")
    expect(normalized.get("languageIds")).toBeNull()
    expect(normalized.get("languageId")).toBeNull()
  })
})
