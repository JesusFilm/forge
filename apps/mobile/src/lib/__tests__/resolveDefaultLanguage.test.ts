import { resolveDefaultSlug } from "../resolveDefaultLanguage"

/**
 * Pure-function tests for watch-session default-language resolution. Device
 * locale (from Intl.DateTimeFormat) is overridden per-test to exercise the
 * priority chain: device locale → video primary → English → first option.
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

  // REGRESSION GUARD: JESUS carries 2281 dubs, of which TWO have a bcp47
  // starting "en" — "english-north-american-indigenous" (en-nai) at index 266
  // and plain "english" (en) at index 614. First-match-by-prefix handed the
  // viewer "English, North American Indigenous". An exact tag must win.
  const enCollision = () => [
    opt("english-north-american-indigenous", "en-nai"),
    opt("english", "en"),
  ]

  it("prefers the exact tag over a longer one sharing its prefix (device step)", () => {
    mockDeviceLocale("en-US")
    expect(resolveDefaultSlug(enCollision(), null)).toBe("english")
  })

  it("prefers the exact tag at the video-primary step", () => {
    mockDeviceLocale("fr-FR")
    expect(resolveDefaultSlug(enCollision(), "en")).toBe("english")
  })

  it("prefers the exact tag at the English fallback step", () => {
    mockDeviceLocale("fr-FR")
    expect(resolveDefaultSlug(enCollision(), "de")).toBe("english")
  })

  it("still falls back to a prefix match when no exact tag exists", () => {
    mockDeviceLocale("en-US")
    // Only the regional tag is offered — it must still be chosen.
    expect(resolveDefaultSlug([opt("en-nai", "en-nai")], null)).toBe("en-nai")
  })

  it("device locale wins over the video primary language when both match", () => {
    mockDeviceLocale("en-US")
    const options = [opt("french", "fr"), opt("english", "en")]
    // primary is French, but the device locale (English) takes priority
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
    // device locale unresolved → primary (none match "ja") → English
    expect(resolveDefaultSlug(options, "ja")).toBe("english")
  })

  it("ignores options with a null bcp47 when matching", () => {
    mockDeviceLocale("en-US")
    const options = [opt("unknown", null), opt("english", "en")]
    expect(resolveDefaultSlug(options, null)).toBe("english")
  })

  describe("preferred language (app-wide persisted choice, matched by slug)", () => {
    it("prefers the persisted language above the device locale", () => {
      mockDeviceLocale("en-US")
      const options = [
        langOpt("v-english", "en", "english"),
        langOpt("v-spanish", "es-419", "spanish"),
      ]
      // Device is English, but the user's persisted choice is Spanish.
      expect(resolveDefaultSlug(options, "en", "spanish")).toBe("v-spanish")
    })

    // The reported bug: bcp47 prefixes collide across distinct languages. An
    // exact languageSlug match must pick the right sibling, not the first by tag.
    it("picks the exact language, not a bcp47-prefix sibling (Korean vs Kurmanji)", () => {
      mockDeviceLocale("en-US")
      // Kurmanji Standard's tag "ko-kmr" shares the "ko" prefix with Korean and
      // is listed FIRST — a prefix match would wrongly return it.
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
      // Preferred Japanese isn't offered → device locale (English) wins.
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
