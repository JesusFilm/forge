// The reader's three token sets (feat-553 KTD12, R34, R36). Every check reads
// the COMPOSITED colour, so a translucent token is judged over its ground.
import { BG_COLOR, TEXT_PRIMARY } from "../../../color"
import { READER_MODES } from "../../settings/snapshot"
import {
  composite,
  contrastRatio,
  parseColor,
  ReaderColorError,
} from "../contrast"
import {
  READER_THEME_TOKENS,
  READER_THEMES,
  readerContrastChecks,
  readerTokens,
  resolveReaderTheme,
  type ReaderTokens,
} from "../palettes"

describe("contrast math", () => {
  it("scores black on white at 21:1 and a colour on itself at 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#cb333b", "#cb333b")).toBeCloseTo(1, 5)
  })

  it("matches the app's documented ACCENT floor (3.39:1 on BG_COLOR)", () => {
    expect(contrastRatio("#CB333B", BG_COLOR)).toBeCloseTo(3.39, 2)
  })

  it("composites a translucent colour over its ground before it scores", () => {
    // Half white over black is mid grey, not white.
    const mid = composite(parseColor("rgba(255, 255, 255, 0.5)"), {
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    })
    expect(mid).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
    expect(contrastRatio("rgba(255, 255, 255, 0.5)", "#000000")).toBeLessThan(
      contrastRatio("#ffffff", "#000000"),
    )
  })

  it("refuses a colour it cannot read, instead of scoring it as black", () => {
    expect(() => parseColor("transparent")).toThrow(ReaderColorError)
    expect(() => parseColor("#12345")).toThrow(ReaderColorError)
  })
})

describe("reader themes", () => {
  it("has exactly Light, Dark, and True Dark, with the two dark ones on the dark scheme", () => {
    expect([...READER_THEMES]).toEqual(["light", "dark", "trueDark"])
    expect(readerTokens("light").scheme).toBe("light")
    expect(readerTokens("dark").scheme).toBe("dark")
    expect(readerTokens("trueDark").scheme).toBe("dark")
  })

  it("uses the app's own tokens for Dark (KTD12)", () => {
    const tokens = readerTokens("dark")
    expect(tokens.background).toBe(BG_COLOR)
    expect(tokens.text).toBe(TEXT_PRIMARY)
  })

  it("uses stone 50 with stone 900 text for Light (KTD12)", () => {
    const tokens = readerTokens("light")
    expect(tokens.background).toBe("#fafaf9")
    expect(tokens.text).toBe("#1c1917")
  })

  it("uses a black ground for True Dark (R34)", () => {
    expect(readerTokens("trueDark").background).toBe("#000000")
  })

  it.each(READER_THEMES)(
    "%s: every drawn pair clears its WCAG AA floor (R36)",
    (theme) => {
      const checks = readerContrastChecks(readerTokens(theme))
      // Anti-vacuous: an empty list would pass every expectation below.
      expect(checks.length).toBeGreaterThanOrEqual(6)
      for (const check of checks) {
        expect({ name: check.name, ok: check.ratio >= check.floor }).toEqual({
          name: check.name,
          ok: true,
        })
      }
    },
  )

  it.each(READER_THEMES)(
    "%s: text and secondary text reach 4.5:1 and the fill 3:1",
    (theme) => {
      const byName = new Map(
        readerContrastChecks(readerTokens(theme)).map((check) => [
          check.name,
          check,
        ]),
      )
      expect(byName.get("text on background")?.floor).toBe(4.5)
      expect(byName.get("secondary text on background")?.floor).toBe(4.5)
      expect(byName.get("progress fill on track")?.floor).toBe(3)
      expect(byName.get("progress fill on background")?.floor).toBe(3)
    },
  )

  it("fails when one theme's text is swapped for a low-contrast value", () => {
    const real = readerTokens("light")
    const swapped: ReaderTokens = { ...real, text: "#e7e5e4" }
    const failing = readerContrastChecks(swapped).filter(
      (check) => check.ratio < check.floor,
    )
    expect(failing.map((check) => check.name)).toEqual(
      expect.arrayContaining(["text on background", "text on button surface"]),
    )
  })

  it("fails when a translucent secondary text washes out over its ground", () => {
    // The composite, not the raw colour, is judged: at 20% alpha the same
    // colour that passes opaque must fail.
    const real = readerTokens("trueDark")
    const faded: ReaderTokens = {
      ...real,
      secondaryText: "rgba(171, 171, 171, 0.2)",
    }
    const failing = readerContrastChecks(faded).filter(
      (check) => check.ratio < check.floor,
    )
    expect(failing.map((check) => check.name)).toContain(
      "secondary text on background",
    )
  })

  it("keeps every token set frozen, so a caller cannot repaint the reader", () => {
    expect(Object.isFrozen(READER_THEME_TOKENS)).toBe(true)
    for (const theme of READER_THEMES) {
      expect(Object.isFrozen(READER_THEME_TOKENS[theme])).toBe(true)
    }
  })

  it("gives a light status bar on dark grounds and a dark one on light", () => {
    expect(readerTokens("dark").statusBarStyle).toBe("light")
    expect(readerTokens("light").statusBarStyle).toBe("dark")
    expect(readerTokens("trueDark").statusBarStyle).toBe("light")
  })
})

describe("resolveReaderTheme", () => {
  it("follows the device in System mode, with Dark, not True Dark", () => {
    expect(resolveReaderTheme("system", "light")).toBe("light")
    expect(resolveReaderTheme("system", "dark")).toBe("dark")
  })

  it("reads an unknown device scheme as dark, the app's own look", () => {
    expect(resolveReaderTheme("system", null)).toBe("dark")
    expect(resolveReaderTheme("system", undefined)).toBe("dark")
    expect(resolveReaderTheme("system", "unspecified")).toBe("dark")
  })

  it("ignores the device when the viewer picks a mode", () => {
    expect(resolveReaderTheme("light", "dark")).toBe("light")
    expect(resolveReaderTheme("dark", "light")).toBe("dark")
    expect(resolveReaderTheme("trueDark", "light")).toBe("trueDark")
  })

  it("covers every stored mode", () => {
    for (const mode of READER_MODES) {
      expect(READER_THEMES).toContain(resolveReaderTheme(mode, "light"))
    }
  })
})
