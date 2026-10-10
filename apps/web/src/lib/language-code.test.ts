import { describe, expect, it } from "vitest"

import { languageCodeFor, primaryLanguageCode } from "./language-code"

describe("primaryLanguageCode", () => {
  it("returns the uppercase primary BCP 47 subtag", () => {
    expect(primaryLanguageCode("pt-BR")).toBe("PT")
    expect(primaryLanguageCode("ru_RU")).toBe("RU")
  })

  it("rejects non-language values", () => {
    expect(primaryLanguageCode("english")).toBeNull()
    expect(primaryLanguageCode(null)).toBeNull()
  })
})

describe("languageCodeFor", () => {
  it("prefers a direct BCP 47 code", () => {
    expect(
      languageCodeFor({ bcp47: "es-ES", iso3: "spa", slug: "english" }),
    ).toBe("ES")
  })

  it("uses the canonical Watch slug mapping when BCP 47 is absent", () => {
    expect(languageCodeFor({ slug: "english" })).toBe("EN")
    expect(languageCodeFor({ slug: "russian" })).toBe("RU")
    expect(languageCodeFor({ slug: "spanish-castilian" })).toBe("ES")
  })

  it("uses ISO 639-3 only when no canonical slug is available", () => {
    expect(languageCodeFor({ slug: "not-a-language", iso3: "fil" })).toBe("FIL")
  })

  it("does not fabricate a code from a human-readable slug", () => {
    expect(languageCodeFor({ slug: "not-a-language" })).toBeNull()
  })
})
