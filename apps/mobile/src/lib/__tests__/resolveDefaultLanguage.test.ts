import { resolveDefaultSlug } from "../resolveDefaultLanguage"

/**
 * Pure-function tests for the default-language resolution used by the watch
 * session (variant + subtitle defaults). Device locale is read from
 * Intl.DateTimeFormat; we override it per-test to exercise each branch of the
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

const opt = (slug: string, bcp47: string | null) => ({ slug, bcp47 })

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
})
