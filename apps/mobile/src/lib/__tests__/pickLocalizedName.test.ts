import { pickLocalizedName, pickLocalizedNameEntry } from "../pickLocalizedName"

describe("pickLocalizedNameEntry (U6: Admin's raw tag, then en)", () => {
  // Admin keys Language.name by its own tag in its own case (`zh-hans`), not
  // by the catalog tag (`zh-Hans`), so the raw tag must match exactly.
  it("tries the raw Admin tag exactly and returns the key it used", () => {
    expect(
      pickLocalizedNameEntry(
        { en: "Spanish", "zh-hans": "西班牙语", "zh-Hans": "wrong" },
        "zh-hans",
      ),
    ).toEqual({ text: "西班牙语", key: "zh-hans" })
  })

  it.each([[{ es: "Español", en: "Spanish" }], [{ ru: "", en: "Spanish" }]])(
    "falls back to en when the raw tag has no name or a blank one: %j",
    (map) => {
      expect(pickLocalizedNameEntry(map, "ru")).toEqual({
        text: "Spanish",
        key: "en",
      })
    },
  )

  it("reports a null key for a plain string", () => {
    expect(pickLocalizedNameEntry("Español", "ru")).toEqual({
      text: "Español",
      key: null,
    })
  })
})

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
