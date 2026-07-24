import { describe, expect, it } from "vitest"

import { isolateBidiDisplayText } from "./bidi"

describe("isolateBidiDisplayText", () => {
  it("balances an LTR name interpolated into RTL display copy", () => {
    expect(
      `عرض جميع الفيديوهات باللغة ${isolateBidiDisplayText("English")}`,
    ).toBe("عرض جميع الفيديوهات باللغة \u2068English\u2069")
  })

  it("balances an RTL name interpolated into LTR display copy", () => {
    expect(`Watch in ${isolateBidiDisplayText("العربية")}`).toBe(
      "Watch in \u2068العربية\u2069",
    )
  })
})
