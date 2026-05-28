import { describe, expect, it } from "vitest"

import {
  isLocale,
  isLocaleSlug,
  resolveUiLocale,
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
  })

  it("passes bcp47 UI locales through unchanged", () => {
    expect(resolveUiLocale("en")).toBe("en")
    expect(resolveUiLocale("es")).toBe("es")
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
