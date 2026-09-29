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
    ["es-MX", "es"],
    ["zh-Hant-TW", "zh-Hant"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-CN", "zh-Hans"],
    ["zh-Hans-CN", "zh-Hans"],
    ["sr-Latn-RS", "sr-Latn"],
    ["sr-RS", "sr"],
    ["zh", "zh"],
    ["en-US", "en"],
    ["tl", "tl"],
    ["fil", "fil"],
    ["fil-PH", "fil"],
    ["yue-Hant-HK", "yue"],
  ])("maps %s to %s", (phoneTag, catalogTag) => {
    expect(resolveLocale([phoneTag], WEB_TAGS).tag).toBe(catalogTag)
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

  it("names how each entry matched", () => {
    expect(resolveLocale(["zh-Hant-TW"], WEB_TAGS).match).toBe("script")
    expect(resolveLocale(["zh-TW"], WEB_TAGS).match).toBe("inferred_script")
    expect(resolveLocale(["es-MX"], WEB_TAGS).match).toBe("language")
    expect(resolveLocale(["zh-Hans"], WEB_TAGS).match).toBe("exact")
  })

  it("infers a script only when the phone sends no script", () => {
    // An explicit script outranks the region table.
    expect(resolveLocale(["zh-Hans-TW"], WEB_TAGS).tag).toBe("zh-Hans")
    expect(resolveLocale(["uz-AF"], WEB_TAGS).tag).toBe("uz-Arab")
    expect(resolveLocale(["sd-IN"], WEB_TAGS).tag).toBe("sd-Deva")
  })

  it("ignores case, underscores, and extension subtags", () => {
    expect(resolveLocale(["ZH-hant-tw"], WEB_TAGS).tag).toBe("zh-Hant")
    expect(resolveLocale(["pt_BR"], WEB_TAGS).tag).toBe("pt")
    expect(resolveLocale(["ar-EG-u-nu-latn"], WEB_TAGS).tag).toBe("ar")
  })

  it("maps legacy Android language codes to their current codes", () => {
    expect(resolveLocale(["iw-IL"], WEB_TAGS).tag).toBe("he")
    expect(resolveLocale(["in-ID"], WEB_TAGS).tag).toBe("id")
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
