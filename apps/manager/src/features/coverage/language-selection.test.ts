import { describe, expect, it } from "vitest"

import {
  hasSelectedLanguages,
  resolveLanguagePresets,
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
})
