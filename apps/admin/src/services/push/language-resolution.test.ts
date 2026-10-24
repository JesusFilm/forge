import { describe, expect, it } from "vitest"

import {
  PUSH_ENGLISH_LANGUAGE_SLUG,
  createPushCopyResolver,
  derivePhoneLanguageSlug,
  resolvePushCopyLanguage,
  type PushLanguageRow,
} from "./language-resolution"

// Two rows share the exact tag `ko`, and kurmanji carries `ko-kmr`, which
// shares only the subtag. Both shapes are real in the Language table.
const LANGUAGES: PushLanguageRow[] = [
  { slug: "english", bcp47: "en" },
  { slug: "arabic", bcp47: "ar" },
  { slug: "french", bcp47: "fr" },
  { slug: "korean", bcp47: "ko" },
  { slug: "korean-north", bcp47: "ko" },
  { slug: "kurmanji-standard", bcp47: "ko-kmr" },
  { slug: "chinese-traditional", bcp47: "zh-Hant" },
  { slug: null, bcp47: "xx" },
]

function resolve(
  copySlugs: string[],
  appLanguageSlug: string | null,
  phoneLocale: string | null,
) {
  return resolvePushCopyLanguage({
    copySlugs,
    languages: LANGUAGES,
    appLanguageSlug,
    phoneLocale,
  })
}

describe("push copy language resolution", () => {
  it("sends the app language copy when the campaign has it (AE4)", () => {
    expect(resolve(["arabic", "english"], "arabic", "en-US")).toEqual({
      languageSlug: "arabic",
      rung: "app_language",
    })
  })

  it("falls to the phone language when the app language has no copy (AE5)", () => {
    expect(
      resolve(["french", "english"], "kurmanji-standard", "fr-FR"),
    ).toEqual({
      languageSlug: "french",
      rung: "phone_subtag",
    })
  })

  it("falls to English when neither phone language has copy (AE6)", () => {
    expect(
      resolve(["french", "english"], "kurmanji-standard", "ko-kmr"),
    ).toEqual({
      languageSlug: "english",
      rung: "fallback",
    })
  })

  it("matches a bare phone tag exactly", () => {
    expect(resolve(["french", "english"], "swahili", "fr")).toEqual({
      languageSlug: "french",
      rung: "phone_tag",
    })
  })

  it("gives the tag with authored copy the win when two languages share it", () => {
    expect(resolve(["korean-north", "english"], "swahili", "ko")).toEqual({
      languageSlug: "korean-north",
      rung: "phone_tag",
    })
    expect(resolve(["korean", "english"], "swahili", "ko")).toEqual({
      languageSlug: "korean",
      rung: "phone_tag",
    })
  })

  it("falls to English when no language sharing the tag has copy", () => {
    expect(resolve(["french", "english"], "swahili", "ko-KR")).toEqual({
      languageSlug: "english",
      rung: "fallback",
    })
  })

  it("resolves a region-qualified tag through the subtag rung", () => {
    expect(resolve(["korean", "english"], "swahili", "ko-KR")).toEqual({
      languageSlug: "korean",
      rung: "phone_subtag",
    })
  })

  it("never reduces a tag past its language subtag", () => {
    // `zh-Hant-TW` reduces to `zh` and stops. The `zh-Hant` row is not a
    // prefix match, so the phone reads English.
    expect(
      resolve(["chinese-traditional", "english"], "swahili", "zh-Hant-TW"),
    ).toEqual({
      languageSlug: "english",
      rung: "fallback",
    })
  })

  it("ignores the case of the phone tag", () => {
    expect(resolve(["kurmanji-standard", "english"], "x", "KO-KMR")).toEqual({
      languageSlug: "kurmanji-standard",
      rung: "phone_tag",
    })
  })

  it("returns null when the campaign has no English copy to fall back to", () => {
    expect(resolve(["french"], "swahili", "ar")).toBeNull()
  })

  it("reads a phone with no app language and no tag as English", () => {
    expect(resolve(["french", "english"], null, null)).toEqual({
      languageSlug: "english",
      rung: "fallback",
    })
  })

  it("builds one resolver per campaign and reuses it per phone", () => {
    const resolver = createPushCopyResolver({
      copySlugs: ["arabic", "english"],
      languages: LANGUAGES,
    })

    expect(
      resolver({ appLanguageSlug: "arabic", phoneLocale: "en-GB" }),
    ).toEqual({ languageSlug: "arabic", rung: "app_language" })
    expect(
      resolver({ appLanguageSlug: "french", phoneLocale: "ar-SA" }),
    ).toEqual({ languageSlug: "arabic", rung: "phone_subtag" })
  })

  it("names English as the fallback slug", () => {
    expect(PUSH_ENGLISH_LANGUAGE_SLUG).toBe("english")
  })
})

describe("phone language slug derivation", () => {
  it("derives the slug from an exact tag", () => {
    expect(derivePhoneLanguageSlug("fr", LANGUAGES)).toBe("french")
  })

  it("derives the slug from the language subtag of a region-qualified tag", () => {
    expect(derivePhoneLanguageSlug("fr-FR", LANGUAGES)).toBe("french")
  })

  it("picks the lowest slug when several languages share the tag", () => {
    expect(derivePhoneLanguageSlug("ko", LANGUAGES)).toBe("korean")
    expect(derivePhoneLanguageSlug("ko-KR", LANGUAGES)).toBe("korean")
  })

  it("prefers the exact tag over the subtag rung", () => {
    expect(derivePhoneLanguageSlug("ko-kmr", LANGUAGES)).toBe(
      "kurmanji-standard",
    )
  })

  it("returns null for a tag no language carries", () => {
    expect(derivePhoneLanguageSlug("zz-ZZ", LANGUAGES)).toBeNull()
  })

  it("returns null for a missing or empty tag", () => {
    expect(derivePhoneLanguageSlug(null, LANGUAGES)).toBeNull()
    expect(derivePhoneLanguageSlug("   ", LANGUAGES)).toBeNull()
  })

  it("drops a language row that carries no slug", () => {
    expect(derivePhoneLanguageSlug("xx", LANGUAGES)).toBeNull()
  })
})
