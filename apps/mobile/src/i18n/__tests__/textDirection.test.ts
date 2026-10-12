// The layout direction and the off switch are mocked at their one source each.
const mockLayout: { rtl: boolean; mirroring: boolean } = {
  rtl: false,
  mirroring: true,
}
jest.mock("../layoutRtl", () => ({ isLayoutRtl: () => mockLayout.rtl }))
jest.mock("../mirroredLayout", () => ({
  get MIRRORED_LAYOUT_ENABLED() {
    return mockLayout.mirroring
  },
}))

import {
  explicitDirectionStyle,
  textAccessibilityLanguage,
  textDirectionProps,
  textDirectionStyle,
} from "../textDirection"

// feat-692 KTD6, checked on the iOS 26.5 simulator and the Android 15 emulator
// (RN 0.86.3): with `direction` set to the text's own language, `textAlign`
// "left" is the start of that language and "right" is its end, on both platforms.
const LTR_LEFT = {
  direction: "ltr",
  writingDirection: "ltr",
  textAlign: "left",
}
const LTR_RIGHT = {
  direction: "ltr",
  writingDirection: "ltr",
  textAlign: "right",
}
const RTL_START = {
  direction: "rtl",
  writingDirection: "rtl",
  textAlign: "left",
}
const RTL_END = {
  direction: "rtl",
  writingDirection: "rtl",
  textAlign: "right",
}

// Today's rule, for the off switch (R10).
const RTL = { direction: "rtl", writingDirection: "rtl" }
const LTR = { direction: "ltr", writingDirection: "ltr" }

beforeEach(() => {
  mockLayout.rtl = false
  mockLayout.mirroring = true
})

describe("textDirectionStyle with mirroring on (R15-R17)", () => {
  describe("in an Arabic layout", () => {
    beforeEach(() => {
      mockLayout.rtl = true
    })

    it("covers AE5: puts a short English title at the right edge", () => {
      expect(textDirectionStyle("en", "ar")).toEqual(LTR_RIGHT)
      expect(textDirectionStyle("en", "ar", { kind: "short" })).toEqual(
        LTR_RIGHT,
      )
    })

    it("covers AE5: puts an English description at the left edge", () => {
      expect(textDirectionStyle("en", "ar", { kind: "paragraph" })).toEqual(
        LTR_LEFT,
      )
    })

    it("puts Arabic text at the start edge for both kinds", () => {
      expect(textDirectionStyle("ar", "ar")).toEqual(RTL_START)
      expect(textDirectionStyle("fa", "ar", { kind: "paragraph" })).toEqual(
        RTL_START,
      )
    })
  })

  describe("in an English layout", () => {
    it("covers AE5: puts a short Arabic title at the left edge", () => {
      expect(textDirectionStyle("ar", "en")).toEqual(RTL_END)
    })

    it("covers AE5: puts an Arabic description at the right edge", () => {
      expect(textDirectionStyle("ar", "en", { kind: "paragraph" })).toEqual(
        RTL_START,
      )
    })

    it("puts left-to-right text at the start edge for both kinds", () => {
      expect(textDirectionStyle("en", "en")).toEqual(LTR_LEFT)
      expect(textDirectionStyle("ru", "en", { kind: "paragraph" })).toEqual(
        LTR_LEFT,
      )
    })
  })

  it("follows the layout in use, not the UI tag", () => {
    // A stuck device keeps a left-to-right layout with an Arabic UI (R8).
    expect(textDirectionStyle("en", "ar")).toEqual(LTR_LEFT)
  })

  it("returns nothing for centered text or a text of unknown language", () => {
    mockLayout.rtl = true
    expect(textDirectionStyle("en", "ar", { centered: true })).toBeUndefined()
    expect(textDirectionStyle(null, "ar")).toBeUndefined()
    expect(textDirectionStyle("", "ar", { kind: "paragraph" })).toBeUndefined()
  })

  it("returns one shared object per result, so a memoized row keeps its style identity", () => {
    mockLayout.rtl = true
    expect(textDirectionStyle("en", "ar")).toBe(textDirectionStyle("ru", "ur"))
    expect(textDirectionStyle("ar", "ar")).toBe(
      textDirectionStyle("fa", "en", { kind: "paragraph" }),
    )
  })
})

describe("textDirectionStyle with mirroring off (R10, KTD13)", () => {
  beforeEach(() => {
    mockLayout.mirroring = false
  })

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

  it("ignores the text kind and the layout, as today", () => {
    mockLayout.rtl = true
    expect(textDirectionStyle("en", "ar", { kind: "paragraph" })).toEqual(LTR)
    expect(textDirectionStyle("ar", "en", { kind: "short" })).toEqual(RTL)
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

describe("explicitDirectionStyle", () => {
  it("gives a known direction the same edges as a language tag", () => {
    mockLayout.rtl = true
    expect(explicitDirectionStyle("ltr")).toBe(textDirectionStyle("en", "ar"))
    expect(explicitDirectionStyle("ltr", { kind: "paragraph" })).toEqual(
      LTR_LEFT,
    )
    expect(explicitDirectionStyle("rtl", { kind: "paragraph" })).toEqual(
      RTL_START,
    )
    mockLayout.rtl = false
    expect(explicitDirectionStyle("rtl")).toEqual(RTL_END)
  })

  it("returns the explicit direction with mirroring off, even where it matches the UI", () => {
    mockLayout.mirroring = false
    expect(explicitDirectionStyle("ltr")).toEqual(LTR)
    expect(explicitDirectionStyle("rtl", { kind: "paragraph" })).toEqual(RTL)
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
  beforeEach(() => {
    mockLayout.rtl = true
  })

  it("covers AE5: English fallback text in an Arabic layout gets the start edge and the English mark", () => {
    expect(textDirectionProps("en", "ar")).toEqual({
      style: LTR_RIGHT,
      accessibilityLanguage: "en",
    })
  })

  it("passes the text kind to the style", () => {
    expect(textDirectionProps("en", "ar", { kind: "paragraph" })).toEqual({
      style: LTR_LEFT,
      accessibilityLanguage: "en",
    })
  })

  it("covers AE5: Arabic text gets the start edge and no mark", () => {
    expect(textDirectionProps("ar", "ar")).toEqual({
      style: RTL_START,
      accessibilityLanguage: undefined,
    })
  })

  it("keeps the mark on centered English fallback text", () => {
    expect(textDirectionProps("en", "ar", { centered: true })).toEqual({
      style: undefined,
      accessibilityLanguage: "en",
    })
  })

  it("adds no mark for English text in an English UI", () => {
    mockLayout.rtl = false
    expect(textDirectionProps("en", "en")).toEqual({
      style: LTR_LEFT,
      accessibilityLanguage: undefined,
    })
  })
})
