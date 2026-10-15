import { LANGUAGE_BCP47_MAP } from "@/lib/language-bcp47-map"

import { describe, expect, it } from "vitest"

import {
  languageBadgeCodeFor,
  languageCodeFor,
  primaryLanguageCode,
} from "./language-code"

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

describe("languageBadgeCodeFor", () => {
  it("keeps regional Portuguese variants distinct", () => {
    expect(languageBadgeCodeFor({ slug: "portuguese-portugal" })).toBe("PT-PT")
    expect(languageBadgeCodeFor({ slug: "portuguese-mozambique" })).toBe(
      "PT-MZ",
    )
  })

  it("distinguishes private-use language variants compactly", () => {
    expect(languageBadgeCodeFor({ slug: "korean" })).toBe("KO")
    expect(languageBadgeCodeFor({ slug: "korean-north" })).toBe("KO-NOR")
    expect(languageBadgeCodeFor({ bcp47: "ko-x-North" })).toBe("KO-NOR")
    expect(languageBadgeCodeFor({ bcp47: "ko", slug: "korean-north" })).toBe(
      "KO-NOR",
    )
  })

  it("preserves extlang and variant subtags used by the public language map", () => {
    expect(languageBadgeCodeFor({ slug: "arabic-gulf" })).toBe("AR-AFB")
    expect(languageBadgeCodeFor({ slug: "arabic-algerian-spoken" })).toBe(
      "AR-ARQ",
    )
    expect(languageBadgeCodeFor({ slug: "kurmanji-standard" })).toBe("KO-KMR")
    expect(languageBadgeCodeFor({ slug: "malagasy-antankarana" })).toBe(
      "MG-XMV",
    )
    expect(languageBadgeCodeFor({ slug: "abanglekuo" })).toBe("BZY-ABA")
    expect(languageBadgeCodeFor({ slug: "basang" })).toBe("BZY-BAS")
    expect(languageBadgeCodeFor({ slug: "mandarin-taiwan" })).toBe("ZH-HANT-TW")
    expect(languageBadgeCodeFor({ slug: "chinese-sichuan" })).toBe("ZH-51")
    expect(languageBadgeCodeFor({ slug: "chinese-yunnan-kunming" })).toBe(
      "ZH-53-KUN",
    )
  })

  it("preserves distinct French language codes and ordinary badges", () => {
    expect(languageBadgeCodeFor({ slug: "french" })).toBe("FR")
    expect(languageBadgeCodeFor({ slug: "french-african" })).toBe("FRA")
    expect(languageBadgeCodeFor({ slug: "english" })).toBe("EN")
    expect(languageBadgeCodeFor({ slug: "russian" })).toBe("RU")
  })

  it("uses variant metadata when no route slug is available", () => {
    expect(languageBadgeCodeFor({ bcp47: "pt-MZ" })).toBe("PT-MZ")
  })

  it("prefers metadata over an unmapped tag-shaped slug", () => {
    expect(languageBadgeCodeFor({ bcp47: "ee", slug: "ewe-gbe" })).toBe("EE")
  })

  it("assigns distinct badges to every mapped language slug", () => {
    const codes = Object.keys(LANGUAGE_BCP47_MAP).map((slug) =>
      languageBadgeCodeFor({ slug }),
    )
    expect(new Set(codes).size).toBe(codes.length)
    expect(
      Math.max(...codes.map((code) => code?.length ?? 0)),
    ).toBeLessThanOrEqual(10)
  })
})
