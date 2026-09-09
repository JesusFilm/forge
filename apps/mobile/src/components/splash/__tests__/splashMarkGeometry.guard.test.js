// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read two sources that must agree.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The JFP mark's box and its alpha centroid are stated TWICE: the generator
// places the symbol in every raster from them, and the splash places the beam
// and the word from them. The generator re-derives its own copy on every run
// (verifyCentroid), so a path redraw updates that one and silently leaves the
// splash behind — the beam would miss the corners of the art it is lighting,
// and every test would stay green because each copy is self-consistent.

const GENERATOR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "generate-app-icon.mjs",
)
const SEQUENCE = path.join(__dirname, "..", "SplashSequence.tsx")

function read(file) {
  const content = fs.readFileSync(file, "utf8")
  // A broken path resolution must not vacuously pass every assertion below.
  expect(content.length).toBeGreaterThan(500)
  return content
}

/**
 * Pure, so a positive-control fixture can prove the detector flags a real
 * drift rather than only that today's two files happen to agree.
 */
function firstNumber(source, pattern) {
  const match = source.match(pattern)
  return match ? Number(match[1]) : null
}

describe("the splash and the icon generator share one mark geometry", () => {
  it("flags a drifted constant (positive control)", () => {
    const pattern = /const CX = ([\d.]+)/
    expect(firstNumber("const CX = 0.5388", pattern)).toBe(0.5388)
    expect(firstNumber("const CX = 0.9", pattern)).not.toBe(0.5388)
    expect(firstNumber("nothing here", pattern)).toBeNull()
  })

  it("agrees on the mark's bounding box", () => {
    const generator = read(GENERATOR)
    const sequence = read(SEQUENCE)

    const width = firstNumber(generator, /const MW = ([\d.]+)/)
    const height = firstNumber(generator, /const MH = ([\d.]+)/)
    expect(width).not.toBeNull()
    expect(height).not.toBeNull()

    expect(firstNumber(sequence, /MARK_ASPECT = ([\d.]+) \/ [\d.]+/)).toBe(
      width,
    )
    expect(firstNumber(sequence, /MARK_ASPECT = [\d.]+ \/ ([\d.]+)/)).toBe(
      height,
    )
    // The bottom-left y is stated as a fraction of the SAME height.
    expect(
      firstNumber(sequence, /MARK_BOTTOM_LEFT_Y = [\d.]+ \/ ([\d.]+)/),
    ).toBe(height)
  })

  it("agrees on the mark's alpha centroid", () => {
    const generator = read(GENERATOR)
    const sequence = read(SEQUENCE)

    expect(firstNumber(sequence, /MARK_CENTROID_X = ([\d.]+)/)).toBe(
      firstNumber(generator, /const CX = ([\d.]+)/),
    )
    expect(firstNumber(sequence, /MARK_CENTROID_Y = ([\d.]+)/)).toBe(
      firstNumber(generator, /const CY = ([\d.]+)/),
    )
  })

  it("takes the bottom-left corner from the mark's own path", () => {
    const generator = read(GENERATOR)
    const sequence = read(SEQUENCE)
    const y = firstNumber(sequence, /MARK_BOTTOM_LEFT_Y = ([\d.]+) \/ [\d.]+/)
    expect(y).not.toBeNull()
    // R9 lands the beam's lower edge on this vertex, so it has to be a point
    // the path actually reaches, not a number that merely looks plausible.
    expect(generator).toContain(String(y))
  })
})
