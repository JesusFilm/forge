import {
  textAccessibilityLanguage,
  textDirectionProps,
  textDirectionStyle,
} from "../textDirection"

const RTL = { direction: "rtl", writingDirection: "rtl" }
const LTR = { direction: "ltr", writingDirection: "ltr" }

describe("textDirectionStyle (KTD13)", () => {
  it.each(["ar", "fa", "ur", "he", "uz-Arab"])(
    "returns the right-to-left style for %s text",
    (lang) => {
      expect(textDirectionStyle(lang, lang)).toEqual(RTL)
      expect(textDirectionStyle(lang, "en")).toEqual(RTL)
    },
  )

  it("returns the left-to-right style for left-to-right text in a right-to-left UI", () => {
    expect(textDirectionStyle("en", "ar")).toEqual(LTR)
    expect(textDirectionStyle("en", "fa")).toEqual(LTR)
    expect(textDirectionStyle("en", "ur")).toEqual(LTR)
    // Not only English: a captured screen keeps its old text after the UI
    // language changes.
    expect(textDirectionStyle("ru", "ar")).toEqual(LTR)
  })

  it("returns nothing for left-to-right text in a left-to-right UI", () => {
    expect(textDirectionStyle("en", "en")).toBeUndefined()
    expect(textDirectionStyle("en", "ru")).toBeUndefined()
    expect(textDirectionStyle("ru", "ru")).toBeUndefined()
    expect(textDirectionStyle("sd-Deva", "en")).toBeUndefined()
  })

  it("returns nothing for centered text", () => {
    expect(textDirectionStyle("ar", "ar", { centered: true })).toBeUndefined()
    expect(textDirectionStyle("en", "ar", { centered: true })).toBeUndefined()
  })

  it("returns nothing when the language of the text is not known", () => {
    expect(textDirectionStyle(null, "ar")).toBeUndefined()
    expect(textDirectionStyle(undefined, "ar")).toBeUndefined()
    expect(textDirectionStyle("", "ar")).toBeUndefined()
  })

  it("returns one shared object, so a memoized row keeps its style identity", () => {
    expect(textDirectionStyle("ar", "ar")).toBe(textDirectionStyle("fa", "en"))
    expect(textDirectionStyle("en", "ar")).toBe(textDirectionStyle("ru", "ur"))
  })
})

describe("textAccessibilityLanguage (R10)", () => {
  it("marks English fallback text on iOS", () => {
    expect(textAccessibilityLanguage("en", "ar", "ios")).toBe("en")
    expect(textAccessibilityLanguage("en", "ru", "ios")).toBe("en")
  })

  // Admin spells tags its own way, so only the primary language must match.
  it.each([
    ["en", "en"],
    ["ar", "ar"],
    ["zh-hans", "zh-Hans"],
    ["pt-br", "pt"],
  ])("marks nothing for %s text in a %s UI", (lang, uiTag) => {
    expect(textAccessibilityLanguage(lang, uiTag, "ios")).toBeUndefined()
  })

  it("marks nothing when the language of the text is not known", () => {
    expect(textAccessibilityLanguage(null, "ar", "ios")).toBeUndefined()
    expect(textAccessibilityLanguage(undefined, "ru", "ios")).toBeUndefined()
  })

  it("marks nothing on Android, where the prop does not exist", () => {
    expect(textAccessibilityLanguage("en", "ar", "android")).toBeUndefined()
  })
})

describe("textDirectionProps", () => {
  it("covers AE5: English fallback text in an Arabic UI gets the left-to-right style and the English mark", () => {
    expect(textDirectionProps("en", "ar")).toEqual({
      style: LTR,
      accessibilityLanguage: "en",
    })
  })

  it("covers AE5: Arabic text gets the right-to-left style and no mark", () => {
    expect(textDirectionProps("ar", "ar")).toEqual({
      style: RTL,
      accessibilityLanguage: undefined,
    })
  })

  it("keeps the mark on centered English fallback text", () => {
    expect(textDirectionProps("en", "ar", { centered: true })).toEqual({
      style: undefined,
      accessibilityLanguage: "en",
    })
  })

  it("adds nothing for English text in an English UI", () => {
    expect(textDirectionProps("en", "en")).toEqual({
      style: undefined,
      accessibilityLanguage: undefined,
    })
  })
})
