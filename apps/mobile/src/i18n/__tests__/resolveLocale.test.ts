import { isRtlTag, resolveLocale } from "../resolveLocale"

// A subset of apps/web/messages, spelled as web spells the file names. Today
// mobile ships only `en`, so these cases pass the catalog set in directly.
const WEB_TAGS = [
  "ar",
  "de",
  "en",
  "es",
  "fil",
  "fr",
  "he",
  "id",
  "nb",
  "no",
  "pt",
  "ru",
  "sd",
  "sd-Deva",
  "sr",
  "sr-Latn",
  "tl",
  "uz",
  "uz-Arab",
  "yue",
  "zh",
  "zh-Hans",
  "zh-Hant",
]

describe("resolveLocale", () => {
  it.each([
    ["es-MX", "es", "language"],
    ["zh-Hant-TW", "zh-Hant", "script"],
    ["zh-TW", "zh-Hant", "inferred_script"],
    ["zh-HK", "zh-Hant", "inferred_script"],
    ["zh-CN", "zh-Hans", "inferred_script"],
    ["zh-Hans-CN", "zh-Hans", "script"],
    ["zh-Hans", "zh-Hans", "exact"],
    ["sr-Latn-RS", "sr-Latn", "script"],
    ["sr-RS", "sr", "language"],
    ["zh", "zh", "exact"],
    ["en-US", "en", "language"],
    ["tl", "tl", "exact"],
    ["fil", "fil", "exact"],
    ["fil-PH", "fil", "language"],
    ["yue-Hant-HK", "yue", "language"],
    // A script is inferred only when the phone sends none, so an explicit
    // script outranks the region table.
    ["zh-Hans-TW", "zh-Hans", "script"],
    ["uz-AF", "uz-Arab", "inferred_script"],
    ["sd-IN", "sd-Deva", "inferred_script"],
    // Case, underscores, and extension subtags do not matter.
    ["ZH-hant-tw", "zh-Hant", "script"],
    ["pt_BR", "pt", "language"],
    ["ar-EG-u-nu-latn", "ar", "language"],
    // Legacy Android language codes map to their current codes.
    ["iw-IL", "he", "language"],
    ["in-ID", "id", "language"],
  ])("maps %s to %s by a %s match", (phoneTag, tag, match) => {
    expect(resolveLocale([phoneTag], WEB_TAGS)).toEqual({
      tag,
      match,
      matchedIndex: 0,
    })
  })

  it("walks the whole list, so [ha, fr] resolves to fr", () => {
    expect(resolveLocale(["ha", "fr"], WEB_TAGS)).toEqual({
      tag: "fr",
      match: "exact",
      matchedIndex: 1,
    })
  })

  it("resolves [ha] to en when no catalog matches (AE4 UI half)", () => {
    expect(resolveLocale(["ha"], WEB_TAGS)).toEqual({
      tag: "en",
      match: "default",
      matchedIndex: -1,
    })
  })

  it("lets the first entry win on a language match over a later exact match", () => {
    expect(resolveLocale(["de-AT", "fr"], WEB_TAGS)).toEqual({
      tag: "de",
      match: "language",
      matchedIndex: 0,
    })
  })

  it("returns the catalog's own spelling of the tag", () => {
    expect(resolveLocale(["zh-hans"], ["en", "zh-Hans"]).tag).toBe("zh-Hans")
  })

  it("skips entries that are not language tags", () => {
    expect(resolveLocale(["", "x", "123", "fr"], WEB_TAGS).tag).toBe("fr")
  })

  it("resolves an empty list to en", () => {
    expect(resolveLocale([], WEB_TAGS).tag).toBe("en")
  })

  it("considers only the catalogs that exist", () => {
    // Today's real catalog set: everything resolves to English.
    expect(resolveLocale(["es-MX", "fr"], ["en"]).tag).toBe("en")
  })
})

describe("isRtlTag", () => {
  it.each([
    "ar",
    "fa",
    "he",
    "ur",
    "ps",
    "sd",
    "ckb",
    "dv",
    "ug",
    "ks",
    "yi",
    "az-Arab",
    "ms-Arab",
    "uz-Arab",
    // Admin spells raw tags in lower case.
    "az-arab",
  ])("treats %s as right-to-left", (tag) => {
    expect(isRtlTag(tag)).toBe(true)
  })

  it.each(["en", "es", "zh-Hans", "sr-Latn", "sd-Deva", "uz", "az"])(
    "treats %s as left-to-right",
    (tag) => {
      expect(isRtlTag(tag)).toBe(false)
    },
  )
})
