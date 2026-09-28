// The reading typeface (feat-553 KTD16, R32): the platform serif for Latin,
// Greek, and Cyrillic text; the platform font for every other script.
import { READER_LINE_SPACING_STEPS } from "../../settings/snapshot"
import {
  readingFontFamily,
  usesReadingTypeface,
  verseLineHeight,
} from "../typography"

describe("usesReadingTypeface", () => {
  it.each([
    ["English", "For God so loved the world"],
    ["extended Latin (Vietnamese)", "Vì Đức Chúa Trời yêu thương thế gian"],
    ["Greek", "Οὕτως γὰρ ἠγάπησεν ὁ θεὸς τὸν κόσμον"],
    ["Cyrillic", "Ибо так возлюбил Бог мир"],
    ["digits and punctuation", "3:16 — “1,2”"],
  ])("keeps the serif for %s", (_name, text) => {
    expect(usesReadingTypeface(text)).toBe(true)
  })

  it.each([
    ["Arabic", "لأَنَّهُ هكَذَا أَحَبَّ اللهُ الْعَالَمَ"],
    ["Hebrew", "כִּי־כֵן אָהַב הָאֱלֹהִים"],
    ["Chinese", "神爱世人"],
    ["Devanagari", "क्योंकि परमेश्वर ने जगत से ऐसा प्रेम रखा"],
    ["Armenian", "Որովհետեւ Աստուած"],
    ["Latin mixed with Thai", "God รัก"],
  ])("uses the platform font for %s", (_name, text) => {
    expect(usesReadingTypeface(text)).toBe(false)
  })
})

describe("readingFontFamily", () => {
  it("uses Georgia on iOS and the system serif on Android", () => {
    expect(readingFontFamily("serif", "Jesus wept.", "ios")).toBe("Georgia")
    expect(readingFontFamily("serif", "Jesus wept.", "android")).toBe("serif")
  })

  it("uses the system face for the sans option", () => {
    expect(readingFontFamily("sans", "Jesus wept.", "ios")).toBe("System")
  })

  it("uses the system face for a script the serif does not cover", () => {
    expect(readingFontFamily("serif", "神爱世人", "ios")).toBe("System")
  })
})

describe("verseLineHeight", () => {
  it("spaces lines by each slider step, rounded to whole points", () => {
    const heights = READER_LINE_SPACING_STEPS.map((spacing) =>
      verseLineHeight(31, spacing),
    )
    for (const height of heights) {
      expect(Number.isInteger(height)).toBe(true)
      expect(height).toBeGreaterThan(31)
    }
    // Each step is a visible change: no two steps round to one height.
    expect(new Set(heights).size).toBe(heights.length)
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
  })

  it("keeps the compact and relaxed ends at their old factors", () => {
    expect(READER_LINE_SPACING_STEPS[0]).toBe(1.2)
    expect(READER_LINE_SPACING_STEPS.at(-1)).toBe(1.6)
  })
})
