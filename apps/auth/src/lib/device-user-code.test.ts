import { describe, expect, it } from "vitest"

import {
  formatUserCodeForDisplay,
  isPlausibleUserCode,
  normalizeUserCode,
  resolveUserCodeInputMode,
  USER_CODE_CHARSET,
  USER_CODE_MAX_LENGTH,
} from "./device-user-code"

describe("normalizeUserCode", () => {
  it("uppercases lowercase input", () => {
    expect(normalizeUserCode("bxkdqwnm")).toBe("BXKDQWNM")
  })

  it("strips the dashes we print for legibility", () => {
    expect(normalizeUserCode("019-450-7302")).toBe("0194507302")
    expect(normalizeUserCode("BXKD-QWNM")).toBe("BXKDQWNM")
  })

  it("strips spaces and tabs from a sloppy paste", () => {
    expect(normalizeUserCode("  019 450\t7302 ")).toBe("0194507302")
  })

  it("strips punctuation that is not in the charset", () => {
    expect(normalizeUserCode("019.450/7302!")).toBe("0194507302")
  })

  it("drops in-alphabet-looking characters that are outside the charset", () => {
    // I and O are deliberately absent so they cannot be read as 1 and 0.
    expect(normalizeUserCode("BIOXKDQWNM")).toBe("BXKDQWNM")
    expect(normalizeUserCode("bioxkdqwnm")).toBe("BXKDQWNM")
  })

  it("drops non-Latin scripts and emoji without corrupting the rest", () => {
    expect(normalizeUserCode("019🙂450あ7302")).toBe("0194507302")
    expect(normalizeUserCode("код019450")).toBe("019450")
  })

  it("does not leave lone surrogates behind when an emoji is stripped", () => {
    const normalized = normalizeUserCode("😀😀😀")
    expect(normalized).toBe("")
    for (const character of normalized) {
      expect(USER_CODE_CHARSET).toContain(character)
    }
  })

  it("caps over-length input at the maximum", () => {
    expect(normalizeUserCode("0123456789ABCDEF")).toHaveLength(
      USER_CODE_MAX_LENGTH,
    )
    expect(normalizeUserCode("0123456789ABCDEF")).toBe("0123456789AB")
  })

  it("counts only in-charset characters toward the cap", () => {
    expect(normalizeUserCode("---0---1---9---4---5---0---7---3---0---2")).toBe(
      "0194507302",
    )
  })

  it("returns an empty string for empty and punctuation-only input", () => {
    expect(normalizeUserCode("")).toBe("")
    expect(normalizeUserCode("   ")).toBe("")
    expect(normalizeUserCode("---")).toBe("")
  })
})

describe("formatUserCodeForDisplay", () => {
  it("groups a 10-character code as 3-3-4", () => {
    expect(formatUserCodeForDisplay("0194507302")).toBe("019-450-7302")
  })

  it("groups an 8-character code as 4-4", () => {
    expect(formatUserCodeForDisplay("BXKDQWNM")).toBe("BXKD-QWNM")
  })

  it("normalizes before grouping, so a re-pasted display value is stable", () => {
    expect(formatUserCodeForDisplay("019-450-7302")).toBe("019-450-7302")
    expect(formatUserCodeForDisplay("bxkd qwnm")).toBe("BXKD-QWNM")
  })

  it("leaves lengths it does not recognize ungrouped", () => {
    expect(formatUserCodeForDisplay("01945")).toBe("01945")
    expect(formatUserCodeForDisplay("")).toBe("")
  })
})

describe("isPlausibleUserCode", () => {
  it("accepts both issued formats, dashed or not", () => {
    expect(isPlausibleUserCode("019-450-7302")).toBe(true)
    expect(isPlausibleUserCode("0194507302")).toBe(true)
    expect(isPlausibleUserCode("bxkd-qwnm")).toBe(true)
  })

  it("rejects partial and over-length input", () => {
    expect(isPlausibleUserCode("")).toBe(false)
    expect(isPlausibleUserCode("019-450")).toBe(false)
    expect(isPlausibleUserCode("019450730")).toBe(false)
    expect(isPlausibleUserCode("0123456789ABCDEF")).toBe(false)
  })

  it("rejects a code that is only out-of-charset characters", () => {
    expect(isPlausibleUserCode("🙂🙂🙂🙂🙂🙂🙂🙂")).toBe(false)
  })
})

describe("resolveUserCodeInputMode", () => {
  it("defaults to the number pad, which matches the issued numeric format", () => {
    expect(resolveUserCodeInputMode("")).toBe("numeric")
    expect(resolveUserCodeInputMode("019-450")).toBe("numeric")
  })

  it("falls back to the full keyboard once a letter is typed", () => {
    expect(resolveUserCodeInputMode("bxkd")).toBe("text")
  })
})
