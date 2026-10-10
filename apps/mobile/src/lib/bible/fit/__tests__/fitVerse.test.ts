// The verse fit (feat-553 R20, KTD16). The AE12 cases read real BSB text but
// measure it with a SYNTHETIC width model (below); only a device run proves
// the real glyph widths.
import {
  FIT_FLOOR_MIN_POINTS,
  FIT_STEP_POINTS,
  MAX_OS_FONT_SCALE,
  fitCandidates,
  fitFloor,
  fitStartSize,
  fitVerse,
  planFit,
  planPlacedFit,
} from "../fitVerse"
import { READER_TEXT_SIZE_STEPS } from "../../settings/snapshot"
import type { BookText } from "../../text/types"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")
const nodePath = jest.requireActual<{ join(...parts: string[]): string }>(
  "path",
)

function bundledVerse(book: string, chapter: number, verse: number): string {
  const file = nodePath.join(
    __dirname,
    "../../../../../assets/bible/bsb",
    `${book}.bible`,
  )
  const text = JSON.parse(fs.readFileSync(file, "utf8")) as BookText
  const found = text.chapters
    .find((item) => item.number === chapter)
    ?.verses.find((item) => item.number === verse)
  if (!found) throw new Error(`no ${book} ${chapter}:${verse} in the asset`)
  return found.lines.map((line) => line.text).join(" ")
}

/** SYNTHETIC: half an em per character, lines 1.35 em apart, monotonic. */
function modelMeasure(text: string, width: number) {
  return (size: number) => {
    const perLine = Math.max(1, Math.floor(width / (size * 0.5)))
    const lines = Math.ceil(text.length / perLine)
    return lines * size * 1.35
  }
}

/** A measure that is a fixed table; any other size fails the case. */
function tableMeasure(table: Record<number, number>) {
  const asked: number[] = []
  const measure = (size: number) => {
    asked.push(size)
    const height = table[size]
    if (height === undefined) throw new Error(`size ${size} not in the table`)
    return height
  }
  return { measure, asked }
}

describe("fit sizes", () => {
  it("starts at the chosen size times the OS font scale", () => {
    expect(fitStartSize(30, 1)).toBe(30)
    expect(fitStartSize(30, 1.3)).toBe(39)
  })

  it("caps the OS font scale at 2", () => {
    expect(MAX_OS_FONT_SCALE).toBe(2)
    expect(fitStartSize(30, 3.1)).toBe(60)
  })

  it("rounds the start, because a fractional size blurs on Android", () => {
    expect(Number.isInteger(fitStartSize(26, 1.15))).toBe(true)
  })

  it("puts the floor at 70% of the chosen size, never under 18", () => {
    expect(FIT_FLOOR_MIN_POINTS).toBe(18)
    expect(fitFloor(22)).toBe(18)
    expect(fitFloor(26)).toBe(19)
    expect(fitFloor(30)).toBe(21)
    expect(fitFloor(42)).toBe(30)
  })

  it("never puts the floor under 70% of the chosen size", () => {
    for (const chosen of READER_TEXT_SIZE_STEPS) {
      expect(fitFloor(chosen)).toBeGreaterThanOrEqual(0.7 * chosen - 1e-9)
      expect(Number.isInteger(fitFloor(chosen))).toBe(true)
    }
  })

  it("steps down by 2 points and ends exactly at the floor", () => {
    expect(FIT_STEP_POINTS).toBe(2)
    expect(fitCandidates(30, 1)).toEqual([30, 28, 26, 24, 22, 21])
    expect(fitCandidates(26, 1)).toEqual([26, 24, 22, 20, 19])
  })

  it("keeps the start when the OS scale puts it under the floor", () => {
    // Shrinking is the only move; the fit never grows the text.
    expect(fitCandidates(22, 0.8)).toEqual([18])
    expect(fitCandidates(22, 0.7)).toEqual([15])
  })
})

describe("fitVerse", () => {
  it("keeps the chosen size for a short verse", () => {
    const { measure, asked } = tableMeasure({ 30: 120 })
    expect(
      fitVerse({ chosenSize: 30, osFontScale: 1, areaHeight: 400, measure }),
    ).toEqual({ size: 30, scroll: false })
    expect(asked).toEqual([30])
  })

  it("steps a long verse down by 2 points until it fits", () => {
    const { measure, asked } = tableMeasure({
      30: 520,
      28: 470,
      26: 410,
      24: 380,
    })
    expect(
      fitVerse({ chosenSize: 30, osFontScale: 1, areaHeight: 400, measure }),
    ).toEqual({ size: 24, scroll: false })
    expect(asked).toEqual([30, 28, 26, 24])
  })

  it("never passes the floor, and scrolls a verse still too tall there", () => {
    const { measure, asked } = tableMeasure({
      30: 900,
      28: 850,
      26: 800,
      24: 760,
      22: 700,
      21: 690,
    })
    expect(
      fitVerse({ chosenSize: 30, osFontScale: 1, areaHeight: 400, measure }),
    ).toEqual({ size: 21, scroll: true })
    expect(Math.min(...asked)).toBe(fitFloor(30))
  })

  it("counts a verse exactly as tall as the area as fitting", () => {
    const { measure } = tableMeasure({ 30: 400 })
    expect(
      fitVerse({ chosenSize: 30, osFontScale: 1, areaHeight: 400, measure }),
    ).toEqual({ size: 30, scroll: false })
  })

  it("scrolls at the floor when the area has no height at all", () => {
    const fit = fitVerse({
      chosenSize: 30,
      osFontScale: 1,
      areaHeight: 0,
      measure: () => 40,
    })
    expect(fit).toEqual({ size: 21, scroll: true })
  })
})

describe("AE12 (logic half): BSB text at the largest size", () => {
  const largest = READER_TEXT_SIZE_STEPS[READER_TEXT_SIZE_STEPS.length - 1]
  // iPhone 17 Pro Max: 440pt wide, a 24pt margin on each side.
  const width = 440 - 2 * 24
  // The phone box with the mini player at the top right (KTD16): 2 x 208.
  const areaWithWindow = 416
  // The same box with no window: 2 x 318.
  const areaWithoutWindow = 636

  it("reads the longest verse in the Bible from the bundled asset", () => {
    expect(bundledVerse("EST", 8, 9).length).toBeGreaterThan(350)
  })

  it("shrinks Esther 8:9 or scrolls it, and never shows it at full size", () => {
    const esther = bundledVerse("EST", 8, 9)
    for (const areaHeight of [areaWithWindow, areaWithoutWindow]) {
      const fit = fitVerse({
        chosenSize: largest,
        osFontScale: 1,
        areaHeight,
        measure: modelMeasure(esther, width),
      })
      expect(fit.size < largest || fit.scroll).toBe(true)
      expect(fit.size).toBeGreaterThanOrEqual(fitFloor(largest))
    }
  })

  it("scrolls Esther 8:9 only at the floor", () => {
    const esther = bundledVerse("EST", 8, 9)
    const fit = fitVerse({
      chosenSize: largest,
      osFontScale: 1,
      areaHeight: areaWithWindow,
      measure: modelMeasure(esther, width),
    })
    expect(fit).toEqual({ size: fitFloor(largest), scroll: true })
  })

  it("shows John 11:35 at the full chosen size", () => {
    const jesusWept = bundledVerse("JHN", 11, 35)
    expect(jesusWept).toBe("Jesus wept.")
    expect(
      fitVerse({
        chosenSize: largest,
        osFontScale: 1,
        areaHeight: areaWithWindow,
        measure: modelMeasure(jesusWept, width),
      }),
    ).toEqual({ size: largest, scroll: false })
  })
})

describe("planFit", () => {
  const base = { chosenSize: 30, osFontScale: 1, areaHeight: 400 }

  it("asks for the start size first, alone", () => {
    expect(planFit({ ...base, heights: new Map() })).toEqual({
      status: "measure",
      sizes: [30],
    })
  })

  it("settles at once when the start size fits", () => {
    expect(planFit({ ...base, heights: new Map([[30, 200]]) })).toEqual({
      status: "done",
      fit: { size: 30, scroll: false },
    })
  })

  it("asks for every smaller size in one batch when the start is too tall", () => {
    expect(planFit({ ...base, heights: new Map([[30, 500]]) })).toEqual({
      status: "measure",
      sizes: [28, 26, 24, 22, 21],
    })
  })

  it("then gives the same answer as the step-by-step fit", () => {
    const heights = new Map([
      [30, 500],
      [28, 460],
      [26, 420],
      [24, 390],
      [22, 350],
      [21, 330],
    ])
    expect(planFit({ ...base, heights })).toEqual({
      status: "done",
      fit: fitVerse({ ...base, measure: (size) => heights.get(size) ?? 0 }),
    })
    expect(planFit({ ...base, heights })).toEqual({
      status: "done",
      fit: { size: 24, scroll: false },
    })
  })

  it("re-plans a smaller area from the heights it already has", () => {
    const heights = new Map([
      [30, 500],
      [28, 460],
      [26, 420],
      [24, 390],
      [22, 350],
      [21, 330],
    ])
    expect(planFit({ ...base, areaHeight: 355, heights })).toEqual({
      status: "done",
      fit: { size: 22, scroll: false },
    })
  })
})

describe("planPlacedFit (KD27): center first, move before scroll", () => {
  const sizes = { chosenSize: 30, osFontScale: 1 }
  // A long verse: 330 tall even at the floor (21).
  const long = new Map([
    [30, 500],
    [28, 460],
    [26, 420],
    [24, 390],
    [22, 350],
    [21, 330],
  ])

  it("passes a measure request through", () => {
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 200,
        freeHeight: 400,
        heights: new Map(),
      }),
    ).toEqual({ status: "measure", sizes: [30] })
  })

  it("keeps a verse centered when it fits there at the chosen size", () => {
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 200,
        freeHeight: 400,
        heights: new Map([[30, 150]]),
      }),
    ).toEqual({
      status: "done",
      fit: { size: 30, scroll: false },
      area: "centered",
    })
  })

  it("keeps a verse centered when it fits there at a smaller size", () => {
    // It would fit the free box at 30, but a centered fit wins (KD9).
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 360,
        freeHeight: 600,
        heights: long,
      }),
    ).toEqual({
      status: "done",
      fit: { size: 22, scroll: false },
      area: "centered",
    })
  })

  it("moves a verse that would scroll to the free box, and fits it there", () => {
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 210,
        freeHeight: 400,
        heights: long,
      }),
    ).toEqual({
      status: "done",
      fit: { size: 24, scroll: false },
      area: "free",
    })
  })

  it("scrolls in the free box only when the verse does not fit it either", () => {
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 210,
        freeHeight: 300,
        heights: long,
      }),
    ).toEqual({
      status: "done",
      fit: { size: 21, scroll: true },
      area: "free",
    })
  })

  it("stays centered when the free box is no taller", () => {
    expect(
      planPlacedFit({
        ...sizes,
        centeredHeight: 300,
        freeHeight: 300,
        heights: long,
      }),
    ).toEqual({
      status: "done",
      fit: { size: 21, scroll: true },
      area: "centered",
    })
  })
})
