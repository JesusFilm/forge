import { describe, expect, it } from "vitest"
import { toWhisperLanguage } from "@/lib/whisper-language"

describe("toWhisperLanguage", () => {
  it("maps plain ISO-639-1 primary subtags through unchanged", () => {
    for (const code of [
      "en",
      "es",
      "fr",
      "de",
      "it",
      "pt",
      "nl",
      "ru",
      "zh",
      "ja",
      "ko",
      "ar",
      "hi",
      "tr",
      "pl",
      "uk",
      "vi",
      "th",
      "id",
      "ms",
      "fa",
      "he",
      "sw",
      "am",
      "ta",
      "te",
      "bn",
      "ur",
    ]) {
      expect(toWhisperLanguage(code), code).toBe(code)
    }
  })

  it("strips region subtags", () => {
    expect(toWhisperLanguage("pt-BR")).toBe("pt")
    expect(toWhisperLanguage("en-US")).toBe("en")
    expect(toWhisperLanguage("es-419")).toBe("es")
  })

  it("strips script + region subtags", () => {
    expect(toWhisperLanguage("zh-Hans-CN")).toBe("zh")
    expect(toWhisperLanguage("sr-Cyrl")).toBe("sr")
  })

  it("is case-insensitive", () => {
    expect(toWhisperLanguage("PT-br")).toBe("pt")
    expect(toWhisperLanguage("EN")).toBe("en")
    expect(toWhisperLanguage("Zh-HANS")).toBe("zh")
  })

  it("tolerates underscore separators", () => {
    expect(toWhisperLanguage("pt_BR")).toBe("pt")
  })

  it("applies whisper's quirk aliases", () => {
    expect(toWhisperLanguage("jv")).toBe("jw") // Javanese
    expect(toWhisperLanguage("nb")).toBe("no") // Norwegian Bokmål
    expect(toWhisperLanguage("fil")).toBe("tl") // Filipino
    expect(toWhisperLanguage("iw")).toBe("he") // legacy Hebrew
    expect(toWhisperLanguage("in")).toBe("id") // legacy Indonesian
    expect(toWhisperLanguage("ji")).toBe("yi") // legacy Yiddish
  })

  it("keeps whisper's 3-letter tokens", () => {
    expect(toWhisperLanguage("haw")).toBe("haw")
    expect(toWhisperLanguage("yue")).toBe("yue")
  })

  it("returns null for unsupported languages", () => {
    expect(toWhisperLanguage("xyz")).toBeNull()
    expect(toWhisperLanguage("kik")).toBeNull() // Kikuyu — not in whisper
    expect(toWhisperLanguage("tlh")).toBeNull()
  })

  it("returns null for null and empty-ish input", () => {
    expect(toWhisperLanguage(null)).toBeNull()
    expect(toWhisperLanguage("")).toBeNull()
    expect(toWhisperLanguage("   ")).toBeNull()
    expect(toWhisperLanguage("-US")).toBeNull()
  })
})
