import { describe, expect, it } from "vitest"

import {
  safeFeedbackText,
  safeFeedbackTitleText,
  truncateWithoutSurrogateSplit,
} from "@/services/feedback-text"

/** Format class, \p{Cf}. */
const ZERO_WIDTH_JOINER = "\u200d"
/** Control class, \p{Cc}. */
const BELL = "\u0007"
/** Default-ignorable but Mn, the class a bare Cf plus Cc pair misses. */
const VARIATION_SELECTOR_16 = "\ufe0f"

describe("safeFeedbackText", () => {
  it("keeps line breaks and runs of spaces so the ticket quotes the message verbatim", () => {
    expect(safeFeedbackText("first line\nsecond line")).toBe(
      "first line\nsecond line",
    )
    expect(safeFeedbackText("two  spaces\n\n  indented")).toBe(
      "two  spaces\n\n  indented",
    )
    expect(safeFeedbackText("carriage\r\nreturn\ttab")).toBe(
      "carriage\r\nreturn\ttab",
    )
  })

  it("escapes markdown syntax, an @ mention, and a URL rejoined by the strip", () => {
    expect(
      safeFeedbackText(
        `**bold** [link](x) @team https://evil${ZERO_WIDTH_JOINER}.example.com`,
      ),
    ).toBe(
      "\\*\\*bold\\*\\* \\[link\\]\\(x\\) \\@team https://evil\\.example\\.com",
    )
  })

  it("strips a format-class invisible character", () => {
    expect(safeFeedbackText(`jesus${ZERO_WIDTH_JOINER}film`)).toBe("jesusfilm")
  })

  it("strips a control-class invisible character", () => {
    expect(safeFeedbackText(`jesus${BELL}film`)).toBe("jesusfilm")
  })

  it("strips a default-ignorable invisible character outside Cf and Cc", () => {
    expect(safeFeedbackText(`jesus${VARIATION_SELECTOR_16}film`)).toBe(
      "jesusfilm",
    )
  })

  it("escapes the markup characters that could restructure the description", () => {
    expect(safeFeedbackText("<b>#1</b> | 50% off!")).toBe(
      "\\<b\\>\\#1\\</b\\> \\| 50% off\\!",
    )
  })
})

describe("safeFeedbackTitleText", () => {
  it("keeps the first line that has visible content", () => {
    expect(
      safeFeedbackTitleText(
        `  \n${ZERO_WIDTH_JOINER}\nLet me download audio only\nfor long drives`,
      ),
    ).toBe("Let me download audio only")
  })

  it("removes structural characters and collapses the remaining whitespace", () => {
    expect(safeFeedbackTitleText("a <b> |c| @d [e]")).toBe("a b c d e")
  })

  it("returns an empty string when the value carries no visible content", () => {
    expect(safeFeedbackTitleText(`   ${ZERO_WIDTH_JOINER}\n\t`)).toBe("")
    expect(safeFeedbackTitleText("")).toBe("")
  })
})

describe("truncateWithoutSurrogateSplit", () => {
  it("returns a value already inside the cap unchanged", () => {
    expect(truncateWithoutSurrogateSplit("abc", 10)).toBe("abc")
    expect(truncateWithoutSurrogateSplit("abc", 3)).toBe("abc")
  })

  it("drops a trailing high surrogate rather than cutting a pair in half", () => {
    expect(truncateWithoutSurrogateSplit("a\u{1f600}b", 2)).toBe("a")
  })

  it("keeps a complete surrogate pair that fits", () => {
    expect(truncateWithoutSurrogateSplit("a\u{1f600}b", 3)).toBe("a\u{1f600}")
  })
})
