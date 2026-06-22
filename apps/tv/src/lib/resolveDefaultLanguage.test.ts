import { resolveDefaultSlug } from "./resolveDefaultLanguage"

/**
 * Default-language resolution tests. Device locale (from Intl.DateTimeFormat) is
 * overridden per-test to exercise each branch of the priority chain:
 * persisted slug → device locale → video primary → English → first.
 */

const realDateTimeFormat = Intl.DateTimeFormat

function mockDeviceLocale(locale: string | null) {
  if (locale === null) {
    // Simulate Intl throwing / unavailable
    Intl.DateTimeFormat = (() => {
      throw new Error("no intl")
    }) as unknown as typeof Intl.DateTimeFormat
    return
  }
  Intl.DateTimeFormat = (() => ({
    resolvedOptions: () => ({ locale }),
  })) as unknown as typeof Intl.DateTimeFormat
}

afterEach(() => {
  Intl.DateTimeFormat = realDateTimeFormat
})

const opt = (slug: string, bcp47: string | null) => ({
  slug,
  bcp47,
  languageSlug: null,
})
// For preference tests: an option carrying its unique language-entity slug.
// `variantSlug` is what resolution returns; `languageSlug` is what a persisted
// preference is matched against.
const langOpt = (
  variantSlug: string,
  bcp47: string | null,
  languageSlug: string,
) => ({ slug: variantSlug, bcp47, languageSlug })

describe("resolveDefaultSlug", () => {
  it("returns null for an empty option list", () => {
    mockDeviceLocale("en-US")
    expect(resolveDefaultSlug([], "en")).toBeNull()
  })

  it("prefers the device locale match by bcp47 prefix", () => {
    mockDeviceLocale("es-MX")
    const options = [opt("english", "en"), opt("spanish", "es-419")]
    expect(resolveDefaultSlug(options, "en")).toBe("spanish")
  })

  it("device locale wins over the video primary language when both match", () => {
    mockDeviceLocale("en-US")
    const options = [opt("french", "fr"), opt("english", "en")]
    expect(resolveDefaultSlug(options, "fr")).toBe("english")
  })

  it("matches device locale on the language prefix, ignoring region", () => {
    mockDeviceLocale("pt-BR")
    const options = [opt("english", "en"), opt("portuguese", "pt-PT")]
    expect(resolveDefaultSlug(options, "en")).toBe("portuguese")
  })

  it("falls back to the video primary language when device locale is absent", () => {
    mockDeviceLocale("de-DE")
    const options = [opt("english", "en"), opt("french", "fr")]
    expect(resolveDefaultSlug(options, "fr")).toBe("french")
  })

  it("falls back to English when neither device locale nor primary match", () => {
    mockDeviceLocale("de-DE")
    const options = [opt("english", "en"), opt("french", "fr")]
    expect(resolveDefaultSlug(options, "ja")).toBe("english")
  })

  it("falls back to the first option when nothing matches", () => {
    mockDeviceLocale("de-DE")
    const options = [opt("french", "fr"), opt("italian", "it")]
    expect(resolveDefaultSlug(options, "ja")).toBe("french")
  })

  it("falls back gracefully when Intl is unavailable", () => {
    mockDeviceLocale(null)
    const options = [opt("french", "fr"), opt("english", "en")]
    expect(resolveDefaultSlug(options, "ja")).toBe("english")
  })

  it("ignores options with a null bcp47 when matching", () => {
    mockDeviceLocale("en-US")
    const options = [opt("unknown", null), opt("english", "en")]
    expect(resolveDefaultSlug(options, null)).toBe("english")
  })

  describe("persisted preference (matched by language slug, never bcp47)", () => {
    it("prefers the persisted language above the device locale", () => {
      mockDeviceLocale("en-US")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-spanish", "es-419", "spanish"),
      ]
      expect(resolveDefaultSlug(options, "en", "spanish")).toBe("v-spanish")
    })

    // The collision bug: bcp47 prefixes are NOT unique. An exact languageSlug
    // match must pick the right sibling, not the first by tag.
    it("picks the exact language, not a bcp47-prefix sibling (Korean vs Kurmanji: ko vs ko-kmr)", () => {
      mockDeviceLocale("en-US")
      // Kurmanji "ko-kmr" shares the "ko" prefix with Korean and is listed FIRST.
      const options = [
        langOpt("v-kurmanji", "ko-kmr", "kurmanji-standard"),
        langOpt("v-korean", "ko", "korean"),
      ]
      expect(resolveDefaultSlug(options, "en", "korean")).toBe("v-korean")
    })

    it("picks plain English, not English North American Indigenous (en vs en-nai)", () => {
      mockDeviceLocale("de-DE")
      const options = [
        langOpt("v-en-nai", "en-nai", "english-north-american-indigenous"),
        langOpt("v-en", "en", "english"),
      ]
      expect(resolveDefaultSlug(options, "en", "english")).toBe("v-en")
    })

    it("falls through to the device locale when no option matches the preference", () => {
      mockDeviceLocale("en-US")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-french", "fr", "french"),
      ]
      expect(resolveDefaultSlug(options, "fr", "japanese")).toBe("v-english")
    })

    it("ignores a null/empty preference and uses the existing chain", () => {
      mockDeviceLocale("es-MX")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-spanish", "es-419", "spanish"),
      ]
      expect(resolveDefaultSlug(options, "en", null)).toBe("v-spanish")
      expect(resolveDefaultSlug(options, "en", "")).toBe("v-spanish")
    })
  })
})
