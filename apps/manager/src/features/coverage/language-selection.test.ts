import { describe, expect, it } from "vitest"

import {
  clearRememberedCoverageLanguageIds,
  hasSelectedLanguages,
  readRememberedCoverageLanguageIds,
  normalizeCoverageLanguageSearchParams,
  parseRequestedLanguageIds,
  resolveCoverageLanguageSelection,
  resolveEnglishLanguageId,
  resolveLanguagePresets,
  resolveRequestedLanguageIds,
  writeRememberedCoverageLanguageIds,
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

  it("resolves English from the language catalog without hardcoding the id", () => {
    const languages: LanguageOption[] = [
      { id: "529", englishLabel: "English", nativeLabel: "English" },
      { id: "6414", englishLabel: "French", nativeLabel: "Français" },
    ]

    expect(resolveEnglishLanguageId(languages)).toBe("529")
    expect(
      resolveEnglishLanguageId([
        { id: "6414", englishLabel: "French", nativeLabel: "Français" },
      ]),
    ).toBeNull()
  })

  it("keeps explicit canonical languageId selection authoritative over memory", () => {
    expect(
      resolveCoverageLanguageSelection({
        currentQuery: "languageId=529",
        rememberedLanguageIds: ["6414"],
        languages: [
          { id: "529", englishLabel: "English", nativeLabel: "English" },
        ],
      }),
    ).toEqual({
      languageIds: ["529"],
      shouldReplaceUrl: false,
      shouldRememberSelection: true,
    })
  })

  it("normalizes legacy languageIds selection without letting memory win", () => {
    expect(
      resolveCoverageLanguageSelection({
        currentQuery: "origin=jobs&languageIds=6414,529",
        rememberedLanguageIds: ["21028"],
        languages: [],
      }),
    ).toEqual({
      languageIds: ["6414", "529"],
      shouldReplaceUrl: true,
      shouldRememberSelection: true,
    })
  })

  it("restores remembered languages for bare coverage routes", () => {
    expect(
      resolveCoverageLanguageSelection({
        currentQuery: "",
        rememberedLanguageIds: ["6414", "529"],
        languages: [
          { id: "529", englishLabel: "English", nativeLabel: "English" },
        ],
      }),
    ).toEqual({
      languageIds: ["6414", "529"],
      shouldReplaceUrl: true,
      shouldRememberSelection: false,
    })
  })

  it("falls back to English for bare routes without remembered languages", () => {
    expect(
      resolveCoverageLanguageSelection({
        currentQuery: "",
        rememberedLanguageIds: [],
        languages: [
          { id: "529", englishLabel: "English", nativeLabel: "English" },
          { id: "6414", englishLabel: "French", nativeLabel: "Français" },
        ],
      }),
    ).toEqual({
      languageIds: ["529"],
      shouldReplaceUrl: true,
      shouldRememberSelection: false,
    })
  })

  it("does not invent a default when English is unavailable", () => {
    expect(
      resolveCoverageLanguageSelection({
        currentQuery: "",
        rememberedLanguageIds: [],
        languages: [
          { id: "6414", englishLabel: "French", nativeLabel: "Français" },
        ],
      }),
    ).toEqual({
      languageIds: [],
      shouldReplaceUrl: false,
      shouldRememberSelection: false,
    })
  })

  it("stores, reads, and clears remembered coverage language ids", () => {
    const storage = new Map<string, string>()
    const memoryStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    }

    writeRememberedCoverageLanguageIds(memoryStorage, [
      " 6414 ",
      "529",
      "6414",
      "",
    ])
    expect(readRememberedCoverageLanguageIds(memoryStorage)).toEqual([
      "6414",
      "529",
    ])

    writeRememberedCoverageLanguageIds(memoryStorage, [])
    expect(readRememberedCoverageLanguageIds(memoryStorage)).toEqual([])

    writeRememberedCoverageLanguageIds(memoryStorage, ["21028"])
    expect(readRememberedCoverageLanguageIds(memoryStorage)).toEqual(["21028"])

    clearRememberedCoverageLanguageIds(memoryStorage)
    expect(readRememberedCoverageLanguageIds(memoryStorage)).toEqual([])
  })
})
