import { describe, expect, it } from "vitest"

import { inventoryLanguageNameForTemplate } from "./inventory-language-name"

const name = (
  nameIn: string,
  uiLocale: string,
  template: unknown = "Videos en {language}",
) => inventoryLanguageNameForTemplate({ name: nameIn, uiLocale, template })

describe("inventoryLanguageNameForTemplate", () => {
  it("returns the lower-case CLDR name mid-sentence when the language is the UI language", () => {
    expect(name("Español", "es")).toBe("español")
    expect(name("Français", "fr")).toBe("français")
  })

  it("keeps the capital for locales whose CLDR name is capitalised", () => {
    expect(name("Deutsch", "de", "Videos in {language}")).toBe("Deutsch")
    expect(name("English", "en", "Videos in {language}")).toBe("English")
  })

  it("never changes anything but case", () => {
    expect(name("Français", "es")).toBe("Français")
    expect(name("Español latinoamericano", "es")).toBe(
      "Español latinoamericano",
    )
  })

  it("keeps the capital when the placeholder opens the string or a sentence", () => {
    expect(name("Español", "es", "{language} por colección")).toBe("Español")
    expect(name("Español", "es", "Hola. {language} aquí")).toBe("Español")
    expect(name("Español", "es", "¿Listo? {language} aquí")).toBe("Español")
    expect(name("Español", "es", "<b>{language}</b> por colección")).toBe(
      "Español",
    )
  })

  it("lowers only when EVERY occurrence is mid-sentence", () => {
    expect(name("Español", "es", "{language} y en {language}")).toBe("Español")
    expect(name("Español", "es", "en {language} y en {language}")).toBe(
      "español",
    )
  })

  it("lowers after a colon or inside mid-sentence markup", () => {
    expect(name("Русский", "ru", "Язык: {language}")).toBe("русский")
    expect(name("Español", "es", "en <b>{language}</b>")).toBe("español")
  })

  it("never changes the name when the template branches on it (ICU select)", () => {
    expect(
      name(
        "Español",
        "es",
        "en {language, select, Español {A} español {B} other {C}}",
      ),
    ).toBe("Español")
  })

  it("treats Armenian, Ethiopic and Urdu terminators as sentence starts", () => {
    expect(name("Español", "es", "Բարև։ {language}")).toBe("Español")
  })

  it("falls back to the supplied name for unreadable templates and unknown locales", () => {
    expect(name("Español", "es", null)).toBe("Español")
    expect(name("Español", "es", ["en {language}"])).toBe("Español")
    expect(name("Español", "not a locale!")).toBe("Español")
  })
})
