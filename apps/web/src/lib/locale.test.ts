import { describe, expect, it } from "vitest"

import {
  isLocale,
  isLocaleSlug,
  isPublicWatchHomeLanguageSlug,
  isPublicWatchLanguageSlug,
  parseAcceptLanguage,
  publicWatchAudioLanguageSlugForLocale,
  publicWatchHomeLanguageSlugForLocale,
  resolveUiLocale,
  resolveUiLocaleForCatalog,
  resolveWatchLocaleIdentity,
  slugToBcp47Tag,
  slugToBcp47Primary,
  textDirectionForLocale,
} from "./locale"
import { LANGUAGE_BCP47_MAP } from "./language-bcp47-map"

describe("isLocale (generated UI catalogs only)", () => {
  it("accepts generated UI catalog locales", () => {
    expect(isLocale("en")).toBe(true)
    expect(isLocale("es")).toBe(true)
    expect(isLocale("fr")).toBe(true)
    expect(isLocale("pt")).toBe(true)
    expect(isLocale("de")).toBe(true)
    expect(isLocale("bn")).toBe(true)
  })

  it("rejects English-name kebab slugs", () => {
    expect(isLocale("russian")).toBe(false)
    expect(isLocale("portuguese-brazil")).toBe(false)
    expect(isLocale("spanish-castilian")).toBe(false)
  })

  it("rejects content slugs", () => {
    expect(isLocale("jesus")).toBe(false)
    expect(isLocale("easter")).toBe(false)
  })
})

describe("isLocaleSlug (bcp47 OR English-name kebab heuristic)", () => {
  it("accepts bcp47 codes", () => {
    expect(isLocaleSlug("en")).toBe(true)
    expect(isLocaleSlug("es")).toBe(true)
  })

  it("accepts multi-segment English-name kebab slugs", () => {
    expect(isLocaleSlug("portuguese-brazil")).toBe(true)
    expect(isLocaleSlug("portuguese-portugal")).toBe(true)
    expect(isLocaleSlug("spanish-castilian")).toBe(true)
    expect(isLocaleSlug("spanish-latin-american")).toBe(true)
    expect(isLocaleSlug("arabic-modern-standard")).toBe(true)
    expect(isLocaleSlug("mandarin-china")).toBe(true)
  })

  it("rejects single-token English-name slugs (heuristic ambiguous with content slugs)", () => {
    // Conservative heuristic: `russian`, `english` collide with content
    // slug shape. The full admin-corpus check is Phase 4. Today these
    // route through the content-slug branch — production-acceptable
    // because the legacy `/watch/russian` shape is rare.
    expect(isLocaleSlug("russian")).toBe(false)
    expect(isLocaleSlug("english")).toBe(false)
  })

  it("rejects content slugs (single-token, no hyphen)", () => {
    expect(isLocaleSlug("jesus")).toBe(false)
    expect(isLocaleSlug("easter")).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isLocaleSlug("")).toBe(false)
  })

  it("rejects uppercase", () => {
    expect(isLocaleSlug("Russian")).toBe(false)
    expect(isLocaleSlug("Portuguese-Brazil")).toBe(false)
  })

  it("rejects slugs starting with digit or hyphen", () => {
    expect(isLocaleSlug("-portuguese-brazil")).toBe(false)
    expect(isLocaleSlug("1-foo")).toBe(false)
  })
})

describe("public watch language slug guards", () => {
  it("accepts English-name audio slugs used in public /watch URLs", () => {
    expect(isPublicWatchLanguageSlug("english")).toBe(true)
    expect(isPublicWatchLanguageSlug("spanish-castilian")).toBe(true)
    expect(isPublicWatchLanguageSlug("spanish-latin-american")).toBe(true)
    expect(isPublicWatchLanguageSlug("portuguese-brazil")).toBe(true)
    expect(isPublicWatchLanguageSlug("russian")).toBe(true)
  })

  it("rejects BCP-47 catalog keys in public /watch URL language slots", () => {
    expect(isPublicWatchLanguageSlug("en")).toBe(false)
    expect(isPublicWatchLanguageSlug("pt-br")).toBe(false)
    expect(isPublicWatchLanguageSlug("es-419")).toBe(false)
  })

  it("rejects stale legacy aliases that current production no longer serves", () => {
    expect(isPublicWatchLanguageSlug("german")).toBe(false)
    expect(isPublicWatchHomeLanguageSlug("german")).toBe(false)
    expect(isPublicWatchLanguageSlug("swahili")).toBe(false)
    expect(isPublicWatchHomeLanguageSlug("swahili")).toBe(false)
  })

  it("maps UI locales to valid public audio and home language slugs", () => {
    expect(publicWatchAudioLanguageSlugForLocale("en")).toBe("english")
    expect(publicWatchAudioLanguageSlugForLocale("es")).toBe(
      "spanish-castilian",
    )
    expect(publicWatchAudioLanguageSlugForLocale("de")).toBe("german-standard")
    expect(publicWatchHomeLanguageSlugForLocale("de")).toBe("german-standard")
  })

  it("infers public audio slugs for generated locales outside the original core set", () => {
    expect(publicWatchAudioLanguageSlugForLocale("ru")).toBe("russian")
    expect(publicWatchAudioLanguageSlugForLocale("bn")).toBe("bangla-2")
    expect(publicWatchHomeLanguageSlugForLocale("es-419")).toBe(
      "spanish-latin-american",
    )
    expect(publicWatchAudioLanguageSlugForLocale("zz")).toBeNull()
  })

  it("rejects unknown and unsafe language segments", () => {
    expect(isPublicWatchLanguageSlug("non-existent")).toBe(false)
    expect(isPublicWatchLanguageSlug("français")).toBe(false)
    expect(isPublicWatchLanguageSlug("")).toBe(false)
  })
})

describe("slugToBcp47Primary", () => {
  it("maps English-name kebab slugs to bcp47 primary subtag", () => {
    expect(slugToBcp47Primary("spanish-castilian")).toBe("es")
    expect(slugToBcp47Primary("portuguese-brazil")).toBe("pt")
    expect(slugToBcp47Primary("portuguese-portugal")).toBe("pt")
    expect(slugToBcp47Primary("portuguese-mozambique")).toBe("pt")
    expect(slugToBcp47Primary("mandarin-china")).toBe("zh")
    expect(slugToBcp47Primary("mandarin-taiwan")).toBe("zh")
    expect(slugToBcp47Primary("arabic-modern-standard")).toBe("ar")
    expect(slugToBcp47Primary("arabic-egyptian-colloquial")).toBe("ar")
    expect(slugToBcp47Primary("german-standard")).toBe("de")
  })

  it("maps single-word language slugs too", () => {
    expect(slugToBcp47Primary("english")).toBe("en")
    expect(slugToBcp47Primary("spanish")).toBe("es")
    expect(slugToBcp47Primary("french")).toBe("fr")
    expect(slugToBcp47Primary("russian")).toBe("ru")
    expect(slugToBcp47Primary("japanese")).toBe("ja")
    expect(slugToBcp47Primary("zulu")).toBe("zu")
  })

  it("accepts bcp47 primary subtag input directly", () => {
    expect(slugToBcp47Primary("en")).toBe("en")
    expect(slugToBcp47Primary("es")).toBe("es")
    expect(slugToBcp47Primary("zh")).toBe("zh")
  })

  it("accepts regional bcp47 input directly", () => {
    expect(slugToBcp47Primary("es-419")).toBe("es")
    expect(slugToBcp47Primary("pt-BR")).toBe("pt")
  })

  it("returns null on unknown slugs", () => {
    expect(slugToBcp47Primary("not-a-language")).toBeNull()
    expect(slugToBcp47Primary("jesus")).toBeNull()
    expect(slugToBcp47Primary("")).toBeNull()
  })

  it("returns null on prototype-pollution keys", () => {
    expect(slugToBcp47Primary("__proto__")).toBeNull()
    expect(slugToBcp47Primary("constructor")).toBeNull()
    expect(slugToBcp47Primary("hasOwnProperty")).toBeNull()
  })
})

describe("slugToBcp47Tag", () => {
  it("preserves finer regional tags for known raw audio slugs", () => {
    expect(slugToBcp47Tag("spanish-castilian")).toBe("es-ES")
    expect(slugToBcp47Tag("spanish-latin-american")).toBe("es-419")
  })

  it("normalizes direct bcp47 tag input", () => {
    expect(slugToBcp47Tag("pt-br")).toBe("pt-BR")
    expect(slugToBcp47Tag("es-419")).toBe("es-419")
  })
})

describe("textDirectionForLocale", () => {
  it.each([
    "ar",
    "az-Arab",
    "ckb",
    "dv",
    "fa",
    "he",
    "ks",
    "ms-Arab",
    "ps",
    "sd",
    "ug",
    "ur",
    "uz-Arab",
  ])("uses RTL for %s", (locale) => {
    expect(textDirectionForLocale(locale)).toBe("rtl")
  })

  it.each(["en", "es-419", "zh-Hans", "az-Cyrl", "ms", "sd-Deva"])(
    "uses LTR for %s",
    (locale) => {
      expect(textDirectionForLocale(locale)).toBe("ltr")
    },
  )

  it("falls back to the primary language for extlang-style Arabic tags", () => {
    expect(textDirectionForLocale("ar-mey")).toBe("rtl")
    expect(textDirectionForLocale("ar-arz")).toBe("rtl")
  })

  it("falls back safely for invalid locale tags", () => {
    expect(textDirectionForLocale("not_a_locale")).toBe("ltr")
  })

  it("uses the textInfo getter when getTextInfo is unavailable", () => {
    const localeDescriptor = Object.getOwnPropertyDescriptor(Intl, "Locale")
    const PropertyOnlyLocale = class {
      get textInfo() {
        return { direction: "rtl" as const }
      }
    }

    Object.defineProperty(Intl, "Locale", {
      configurable: true,
      value: PropertyOnlyLocale,
    })

    try {
      expect(textDirectionForLocale("ar")).toBe("rtl")
    } finally {
      if (localeDescriptor) {
        Object.defineProperty(Intl, "Locale", localeDescriptor)
      }
    }
  })

  it("uses getTextInfo when available", () => {
    const localeDescriptor = Object.getOwnPropertyDescriptor(Intl, "Locale")
    const MethodLocale = class {
      getTextInfo() {
        return { direction: "rtl" as const }
      }
    }

    Object.defineProperty(Intl, "Locale", {
      configurable: true,
      value: MethodLocale,
    })

    try {
      expect(textDirectionForLocale("ar")).toBe("rtl")
    } finally {
      if (localeDescriptor) {
        Object.defineProperty(Intl, "Locale", localeDescriptor)
      }
    }
  })

  it("falls back to explicit script and language subtags without text-info APIs", () => {
    const localeDescriptor = Object.getOwnPropertyDescriptor(Intl, "Locale")
    const directionByTag = new Map<string, "ltr" | "rtl">()
    const localePartsByTag = new Map<
      string,
      { language: string; script: string | undefined }
    >()
    for (const tag of new Set(Object.values(LANGUAGE_BCP47_MAP))) {
      directionByTag.set(tag, textDirectionForLocale(tag))
      try {
        const locale = new Intl.Locale(tag)
        localePartsByTag.set(tag, {
          language: locale.language,
          script: locale.script,
        })
      } catch {
        // Some admin values are legacy compound tags rather than structurally
        // valid BCP-47. Preserve their normal safe-LTR behavior in this corpus
        // check while exercising canonical subtags for every constructible tag.
      }
    }
    const BasicLocale = class {
      language: string
      script: string | undefined

      constructor(locale: string) {
        const canonicalParts = localePartsByTag.get(locale)
        if (canonicalParts) {
          this.language = canonicalParts.language
          this.script = canonicalParts.script
          return
        }
        const [language, script] = locale.split("-")
        this.language = language ?? ""
        this.script = script?.length === 4 ? script : undefined
      }
    }

    Object.defineProperty(Intl, "Locale", {
      configurable: true,
      value: BasicLocale,
    })

    try {
      expect(textDirectionForLocale("ar")).toBe("rtl")
      expect(textDirectionForLocale("az-Arab")).toBe("rtl")
      expect(textDirectionForLocale("mey-Latn")).toBe("ltr")
      expect(textDirectionForLocale("en")).toBe("ltr")
      for (const [tag, expectedDirection] of directionByTag) {
        expect(textDirectionForLocale(tag), tag).toBe(expectedDirection)
      }
    } finally {
      if (localeDescriptor) {
        Object.defineProperty(Intl, "Locale", localeDescriptor)
      }
    }
  })
})

describe("parseAcceptLanguage", () => {
  it("falls regional browser locales back to the closest generated catalog", () => {
    expect(parseAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt")
    expect(parseAcceptLanguage("es-419,es;q=0.9")).toBe("es")
  })

  it("returns null when no generated catalog is available", () => {
    expect(parseAcceptLanguage("aiw-ET,aiw;q=0.9")).toBeNull()
  })
})

describe("resolveUiLocale (catalog-driven fallback)", () => {
  it("resolves spanish-* slugs to the UI locale 'es'", () => {
    expect(resolveUiLocale("spanish-castilian")).toBe("es")
    expect(resolveUiLocale("spanish")).toBe("es")
  })

  it("resolves portuguese-* slugs to the UI locale 'pt'", () => {
    expect(resolveUiLocale("portuguese-brazil")).toBe("pt")
    expect(resolveUiLocale("portuguese-portugal")).toBe("pt")
    expect(resolveUiLocale("portuguese-mozambique")).toBe("pt")
  })

  it("resolves french-* slugs to the UI locale 'fr'", () => {
    expect(resolveUiLocale("french")).toBe("fr")
    expect(resolveUiLocale("french-african")).toBe("fr")
  })

  it("resolves german-* slugs to the UI locale 'de'", () => {
    expect(resolveUiLocale("german-standard")).toBe("de")
    expect(resolveUiLocale("german")).toBeNull()
  })

  it("passes bcp47 UI locales through unchanged", () => {
    expect(resolveUiLocale("en")).toBe("en")
    expect(resolveUiLocale("bn")).toBe("bn")
    expect(resolveUiLocale("es")).toBe("es")
    expect(resolveUiLocale("es-419")).toBe("es")
    expect(resolveUiLocale("fr")).toBe("fr")
    expect(resolveUiLocale("pt")).toBe("pt")
    expect(resolveUiLocale("de")).toBe("de")
  })

  it("returns null for languages outside generated UI catalogs", () => {
    // Aari is a valid public audio language, but it is not part of the
    // official-language inventory catalog rollout.
    expect(resolveUiLocale("aari")).toBeNull()
  })

  it("returns null for unknown slugs and content-slug shapes", () => {
    expect(resolveUiLocale("not-a-language")).toBeNull()
    expect(resolveUiLocale("jesus")).toBeNull()
    expect(resolveUiLocale("")).toBeNull()
  })

  it("uses the closest generated catalog when a future catalog exists", () => {
    expect(resolveUiLocaleForCatalog("russian", ["en", "ru"])).toBe("ru")
    expect(resolveUiLocaleForCatalog("ru-RU", ["en", "ru"])).toBe("ru")
    expect(resolveUiLocaleForCatalog("zh-Hant-TW", ["en", "zh-Hant"])).toBe(
      "zh-Hant",
    )
    expect(resolveUiLocaleForCatalog("zh-Hant-TW", ["en"])).toBeNull()
  })
})

describe("resolveWatchLocaleIdentity", () => {
  it("splits raw audio slug, message catalog key, and static html lang", () => {
    expect(resolveWatchLocaleIdentity("spanish-latin-american")).toEqual({
      locale: "es",
      htmlLang: "es-419",
    })
  })

  it("uses the regional English identity for the British homepage", () => {
    expect(resolveWatchLocaleIdentity("english-british")).toEqual({
      locale: "en",
      htmlLang: "en-GB",
    })
  })

  it("keeps unsupported audio families in the URL while falling chrome back to English", () => {
    expect(resolveWatchLocaleIdentity("aari")).toEqual({
      locale: "en",
      htmlLang: "en",
    })
  })

  it("uses imported chrome catalogs for old watch app locales", () => {
    expect(resolveWatchLocaleIdentity("bangla-2")).toEqual({
      locale: "bn",
      htmlLang: "bn",
    })
    expect(resolveWatchLocaleIdentity("russian")).toEqual({
      locale: "ru",
      htmlLang: "ru",
    })
    expect(resolveWatchLocaleIdentity("mandarin-china")).toEqual({
      locale: "zh",
      htmlLang: "zh",
    })
  })

  it("keeps Hassaniyya on its explicit Latin-script UI catalog", () => {
    expect(resolveWatchLocaleIdentity("arabic-hassaniya")).toEqual({
      locale: "mey-Latn",
      htmlLang: "mey-Latn",
    })
    expect(resolveWatchLocaleIdentity("ar-mey")).toEqual({
      locale: "mey-Latn",
      htmlLang: "mey-Latn",
    })
    expect(textDirectionForLocale("mey-Latn")).toBe("ltr")
  })

  it("does not preserve the stale home-only German language alias", () => {
    expect(resolveWatchLocaleIdentity("german")).toEqual({
      locale: "en",
      htmlLang: "en",
    })
    expect(isPublicWatchLanguageSlug("german")).toBe(false)
    expect(isPublicWatchHomeLanguageSlug("german")).toBe(false)
  })

  it("defaults locale-less surfaces to English", () => {
    expect(resolveWatchLocaleIdentity(null)).toEqual({
      locale: "en",
      htmlLang: "en",
    })
  })
})
