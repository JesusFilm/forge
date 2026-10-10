import { describe, expect, it } from "vitest"

import {
  declaredLanguageAttributes,
  derivedNativeNameLang,
  primaryTagMatchesScript,
  selectOwnLanguageName,
} from "@/lib/language-native-name"

describe("selectOwnLanguageName", () => {
  it.each([
    ["ar", { en: "Arabic", ar: "العربية" }, "العربية", "ar"],
    ["he", { en: "Hebrew", he: "עברית" }, "עברית", "he"],
    [
      "ckb",
      { en: "Kurdish, Sorani", ckb: "کوردیی ناوەندی" },
      "کوردیی ناوەندی",
      "ckb",
    ],
    ["ru", { en: "Russian", ru: "Русский" }, "Русский", "ru"],
    ["zh", { en: "Mandarin", zh: "中文" }, "中文", "zh"],
    ["es", { en: "Spanish", es: "Español" }, "Español", "es"],
  ])("selects the own-language key for %s", (bcp47, names, text, lang) => {
    expect(selectOwnLanguageName(names, bcp47)).toEqual({ text, lang })
  })

  it("matches the exact canonical tag and preserves its script", () => {
    expect(
      selectOwnLanguageName(
        { en: "Chinese, Traditional", "zh-hant": "繁體中文" },
        "zh-Hant",
      ),
    ).toEqual({ text: "繁體中文", lang: "zh-Hant" })
  })

  it("uses the primary key for a regional tag whose script matches", () => {
    expect(
      selectOwnLanguageName(
        { en: "Spanish, Latin American", es: "Español latinoamericano" },
        "es-419",
      ),
    ).toEqual({ text: "Español latinoamericano", lang: "es" })
    expect(
      selectOwnLanguageName({ en: "Russian", ru: "Русский" }, "ru-RU"),
    ).toEqual({ text: "Русский", lang: "ru" })
  })

  it("refuses a primary key written in a different script (ku-Arab vs ku)", () => {
    // `ku` maximizes to ku-Latn: this entry is Latin-script Kurmanji.
    const names = { en: "Kurdish", ku: "kurdî" }
    expect(selectOwnLanguageName(names, "ku-Arab")).toBeNull()
    // Same entry IS the name of ku-Latn (text kept; `ku` is not a tag this app
    // declares today, so it stays untagged rather than guessed).
    expect(selectOwnLanguageName(names, "ku-Latn")).toEqual({
      text: "kurdî",
      lang: null,
    })
  })

  it("keeps an exact ku-Arab entry for ku-Arab, untagged because the tag is not a known declarable tag", () => {
    expect(
      selectOwnLanguageName({ en: "Kurdish", "ku-Arab": "کوردی" }, "ku-Arab"),
    ).toEqual({ text: "کوردی", lang: null })
  })

  it("refuses a Simplified primary entry for a Traditional tag", () => {
    expect(
      selectOwnLanguageName({ en: "Chinese", zh: "中文" }, "zh-Hant-TW"),
    ).toBeNull()
  })

  it("ignores key order: a shuffled French map still selects the French entry", () => {
    const shuffled = {
      de: "Französisch",
      es: "Francés",
      en: "French",
      fr: "Français",
    }
    expect(selectOwnLanguageName(shuffled, "fr")).toEqual({
      text: "Français",
      lang: "fr",
    })
    // The old first-non-en pick would have returned "Französisch".
    expect(
      selectOwnLanguageName({ en: "French", de: "Französisch" }, "fr"),
    ).toBeNull()
  })

  it("never guesses a native or local key", () => {
    expect(
      selectOwnLanguageName({ en: "French", native: "Français" }, "fr"),
    ).toBeNull()
    expect(
      selectOwnLanguageName({ en: "French", local: "Français" }, "fr"),
    ).toBeNull()
  })

  it("returns null without evidence or when the own name equals English", () => {
    expect(selectOwnLanguageName({ en: "Arabic", ar: "ar" }, null)).toBeNull()
    expect(selectOwnLanguageName({ en: "Arabic" }, "  ")).toBeNull()
    expect(selectOwnLanguageName(null, "ar")).toBeNull()
    expect(selectOwnLanguageName(["x"], "ar")).toBeNull()
    expect(selectOwnLanguageName({ en: "English" }, "en")).toBeNull()
    expect(selectOwnLanguageName({ en: "Italian", it: " " }, "it")).toBeNull()
  })

  it("keeps the own-language text but withholds lang for an invalid or unknown tag", () => {
    // Real admin tag: new Intl.Locale throws, so it is not declarable.
    expect(
      selectOwnLanguageName(
        { en: "Huasteco", "hus-MX-SLP": "Teenek" },
        "hus-MX-SLP",
      ),
    ).toEqual({ text: "Teenek", lang: null })
    // Unparseable tag with only a primary entry: no script evidence, no pick.
    expect(
      selectOwnLanguageName({ en: "Huasteco", hus: "Teenek" }, "hus-MX-SLP"),
    ).toBeNull()
    // Well-formed but not a tag the app knows: text kept, never declared.
    expect(selectOwnLanguageName({ en: "Zzz", zz: "Zed" }, "zz")).toEqual({
      text: "Zed",
      lang: null,
    })
  })
})

describe("primaryTagMatchesScript", () => {
  it("compares likely scripts of the primary and the full tag", () => {
    expect(primaryTagMatchesScript("ru")).toBe(true)
    expect(primaryTagMatchesScript("ru-RU")).toBe(true)
    expect(primaryTagMatchesScript("zh-Hans-CN")).toBe(true)
    expect(primaryTagMatchesScript("zh-Hant")).toBe(false)
    expect(primaryTagMatchesScript("ku-Arab")).toBe(false)
    expect(primaryTagMatchesScript("ku-Latn")).toBe(true)
    expect(primaryTagMatchesScript("hus-MX-SLP")).toBe(false)
  })
})

describe("derivedNativeNameLang", () => {
  it("tags an Intl-derived label with the primary subtag only", () => {
    expect(derivedNativeNameLang("ru-RU")).toBe("ru")
    expect(derivedNativeNameLang("es-419")).toBe("es")
    expect(derivedNativeNameLang("ar")).toBe("ar")
  })

  it("withholds the tag when the script differs, the tag is unknown or invalid", () => {
    expect(derivedNativeNameLang("ku-Arab")).toBeNull()
    expect(derivedNativeNameLang("zh-Hant-XX")).toBeNull()
    expect(derivedNativeNameLang("hus-MX-SLP")).toBeNull()
    expect(derivedNativeNameLang("zz")).toBeNull()
    expect(derivedNativeNameLang(null)).toBeNull()
  })
})

describe("declaredLanguageAttributes", () => {
  it.each([
    ["ar", "ar", "rtl"],
    ["he", "he", "rtl"],
    ["ckb", "ckb", "rtl"],
    ["ru", "ru", "ltr"],
    ["zh-hant", "zh-Hant", "ltr"],
    ["es", "es", "ltr"],
  ] as const)("declares %s with script and direction", (input, lang, dir) => {
    expect(declaredLanguageAttributes(input)).toEqual({ lang, dir })
  })

  it("does not declare unknown, invalid or empty tags", () => {
    expect(declaredLanguageAttributes("zz")).toBeNull()
    expect(declaredLanguageAttributes("hus-MX-SLP")).toBeNull()
    expect(declaredLanguageAttributes("ku-Arab")).toBeNull()
    expect(declaredLanguageAttributes("")).toBeNull()
    expect(declaredLanguageAttributes(null)).toBeNull()
  })
})
