import { describe, expect, it } from "vitest"
import {
  normalizeGeneratedSubtitleLanguage,
  resolveCmsLanguageCode,
  resolveMuxSubtitleLanguageCode,
} from "@/lib/mux-language"

describe("mux language resolution", () => {
  it("normalizes supported mux codes and locale roots", () => {
    expect(normalizeGeneratedSubtitleLanguage("ru")).toBe("ru")
    expect(normalizeGeneratedSubtitleLanguage("ru-RU")).toBe("ru")
    expect(normalizeGeneratedSubtitleLanguage("auto")).toBe("auto")
  })

  it("falls back to auto for unknown values", () => {
    expect(normalizeGeneratedSubtitleLanguage("3934")).toBe("auto")
    expect(normalizeGeneratedSubtitleLanguage("zzz")).toBe("auto")
    expect(normalizeGeneratedSubtitleLanguage(undefined)).toBe("auto")
  })

  it("resolves supported mux codes from bcp47 metadata", () => {
    expect(
      resolveMuxSubtitleLanguageCode({
        coreId: "3934",
        bcp47: "ru-RU",
        iso3: "rus",
      }),
    ).toBe("ru")
  })

  it("falls back to iso3 when bcp47 is unavailable", () => {
    expect(
      resolveMuxSubtitleLanguageCode({
        coreId: "3934",
        bcp47: null,
        iso3: "rus",
      }),
    ).toBe("ru")
  })

  it("returns auto when cms metadata cannot be mapped safely", () => {
    expect(
      resolveMuxSubtitleLanguageCode({
        coreId: "3934",
        bcp47: null,
        iso3: null,
      }),
    ).toBe("auto")
  })

  it("resolves generic cms language codes independently from mux support", () => {
    expect(
      resolveCmsLanguageCode({
        coreId: "13974",
        bcp47: "ja-JP",
        iso3: "jpn",
      }),
    ).toBe("ja")
    expect(
      resolveCmsLanguageCode({
        coreId: "3934",
        bcp47: null,
        iso3: "rus",
      }),
    ).toBe("ru")
    expect(resolveCmsLanguageCode("6414")).toBeNull()
  })
})
