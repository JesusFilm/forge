import { pickLocalizedName } from "../pickLocalizedName"

describe("pickLocalizedName", () => {
  it("returns English value from locale map", () => {
    expect(pickLocalizedName({ en: "English", es: "Español" })).toBe("English")
  })

  it("returns preferred locale when specified", () => {
    expect(pickLocalizedName({ en: "English", es: "Español" }, "es")).toBe(
      "Español",
    )
  })

  it("falls back through locale order when preferred is missing", () => {
    expect(pickLocalizedName({ fr: "Français", de: "Deutsch" })).toBe(
      "Français",
    )
  })

  it("returns first available value when no fallback locale matches", () => {
    expect(pickLocalizedName({ zh_TW: "繁體中文" })).toBe("繁體中文")
  })

  it("returns undefined for empty object", () => {
    expect(pickLocalizedName({})).toBeUndefined()
  })

  it("returns undefined for null", () => {
    expect(pickLocalizedName(null)).toBeUndefined()
  })

  it("returns undefined for undefined", () => {
    expect(pickLocalizedName(undefined)).toBeUndefined()
  })

  it("returns string value as-is", () => {
    expect(pickLocalizedName("plain string")).toBe("plain string")
  })
})
