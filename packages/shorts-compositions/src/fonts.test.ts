import { describe, expect, it } from "vitest"

import { loadShortFonts, SHORT_FONT_FAMILIES } from "./fonts"
import {
  INTER_LATIN_WOFF2_BASE64,
  MONTSERRAT_LATIN_WOFF2_BASE64,
} from "./fonts-data"

const WOFF2_MAGIC = "wOF2"

describe("fonts-data", () => {
  it.each([
    ["Montserrat", MONTSERRAT_LATIN_WOFF2_BASE64],
    ["Inter", INTER_LATIN_WOFF2_BASE64],
  ])("embeds %s as non-empty base64 woff2 bytes", (_family, base64) => {
    expect(typeof base64).toBe("string")
    expect(base64.length).toBeGreaterThan(1000)
    const bytes = Buffer.from(base64, "base64")
    expect(bytes.subarray(0, 4).toString("latin1")).toBe(WOFF2_MAGIC)
  })
})

describe("fonts", () => {
  it("exposes loadShortFonts as a function (not executed — needs DOM)", () => {
    expect(typeof loadShortFonts).toBe("function")
  })

  it("maps the captionFont knob values to CSS family names", () => {
    expect(SHORT_FONT_FAMILIES.montserrat).toBe("Montserrat")
    expect(SHORT_FONT_FAMILIES.inter).toBe("Inter")
  })
})
