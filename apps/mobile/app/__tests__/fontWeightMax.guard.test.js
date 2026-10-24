// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: bold (700) is the heaviest text weight the app may use. Product rule,
// 2026-09-17: SF Pro at 800 (heavy) and 900 (black) read as too heavy.
const TOO_HEAVY =
  /\bfontWeight\s*:\s*(?:["'](?:800|900|heavy|black)["']|(?:800|900)\b)/

const APP_DIR = path.join(__dirname, "..")
const SRC_DIR = path.join(__dirname, "..", "..", "src")
const ROOTS = [APP_DIR, SRC_DIR]

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe("no text heavier than bold", () => {
  it.each([
    [`fontWeight: "800",`],
    [`fontWeight: '900'`],
    [`fontWeight:"heavy"`],
    [`{ fontWeight: "black" }`],
    [`fontWeight: 800`],
  ])("flags %s (positive control)", (source) => {
    expect(TOO_HEAVY.test(source)).toBe(true)
  })

  it.each([
    [`fontWeight: "700"`],
    [`fontWeight: "bold"`],
    [`fontWeight: 600`],
    [`fontWeight: "80"`],
  ])("allows %s (negative control)", (source) => {
    expect(TOO_HEAVY.test(source)).toBe(false)
  })

  it("finds no weight above bold in app/ or src/", () => {
    const files = ROOTS.flatMap(sourceFiles)
    // A floor, so a broken walk cannot pass by scanning nothing.
    expect(files.length).toBeGreaterThan(100)
    const offenders = files
      .filter((file) => TOO_HEAVY.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(path.join(__dirname, "..", ".."), file))
    expect(offenders).toEqual([])
  })
})
