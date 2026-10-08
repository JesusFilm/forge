// The screen-reader tag for a catalog language (plan 2026-10-08, KTD7). The
// catalog keys languages by ISO 639-3, and a screen reader wants BCP-47.
import { catalogLanguageTag } from "../language/phoneLanguage"

describe("catalogLanguageTag", () => {
  it.each([
    ["kor", "ko"],
    ["rus", "ru"],
    // Individual languages take their macrolanguage's two-letter code.
    ["arb", "ar"],
    ["cmn", "zh"],
    ["pes", "fa"],
  ])("maps %s to %s", (code, tag) => {
    expect(catalogLanguageTag(code)).toBe(tag)
  })

  it("keeps a code that has no shorter form", () => {
    expect(catalogLanguageTag("gue")).toBe("gue")
  })
})
