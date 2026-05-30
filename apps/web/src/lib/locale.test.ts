import { describe, expect, it } from "vitest"

import {
  isLocale,
  isLocaleSlug,
  isPublicWatchHomeLanguageSlug,
  isPublicWatchLanguageSlug,
  publicWatchAudioLanguageSlugForLocale,
  publicWatchHomeLanguageSlugForLocale,
  resolveUiLocale,
  resolveWatchLocaleIdentity,
  slugToBcp47Tag,
  slugToBcp47Primary,
} from "./locale"

describe("isLocale (bcp47 only)", () => {
  it("accepts known UI template locales", () => {
    expect(isLocale("en")).toBe(true)
    expect(isLocale("es")).toBe(true)
    expect(isLocale("fr")).toBe(true)
    expect(isLocale("pt")).toBe(true)
    expect(isLocale("de")).toBe(true)
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

describe("resolveUiLocale (family fallback into UI_LOCALE_FAMILIES)", () => {
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
    expect(resolveUiLocale("es")).toBe("es")
    expect(resolveUiLocale("es-419")).toBe("es")
    expect(resolveUiLocale("fr")).toBe("fr")
    expect(resolveUiLocale("pt")).toBe("pt")
    expect(resolveUiLocale("de")).toBe("de")
  })

  it("returns null for languages outside UI_LOCALE_FAMILIES", () => {
    // Mandarin (zh), Russian (ru), Arabic (ar), etc. — admin recognizes them
    // but the apps/web UI chrome only ships in 5 locales today.
    expect(resolveUiLocale("mandarin-china")).toBeNull()
    expect(resolveUiLocale("russian")).toBeNull()
    expect(resolveUiLocale("arabic-modern-standard")).toBeNull()
    expect(resolveUiLocale("japanese")).toBeNull()
    expect(resolveUiLocale("zulu")).toBeNull()
  })

  it("returns null for unknown slugs and content-slug shapes", () => {
    expect(resolveUiLocale("not-a-language")).toBeNull()
    expect(resolveUiLocale("jesus")).toBeNull()
    expect(resolveUiLocale("")).toBeNull()
  })
})

describe("resolveWatchLocaleIdentity", () => {
  it("splits raw audio slug, message catalog key, and static html lang", () => {
    expect(resolveWatchLocaleIdentity("spanish-latin-american")).toEqual({
      locale: "es",
      htmlLang: "es-419",
    })
  })

  it("keeps unsupported audio families in the URL while falling chrome back to English", () => {
    expect(resolveWatchLocaleIdentity("mandarin-china")).toEqual({
      locale: "en",
      htmlLang: "en",
    })
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
