// Plain JS (like the other guard suites here): the RN tsconfig has no Node
// types, and this guard reads the feature's sources off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The kind set is ONE declaration, in the leaf every module already imports.
// A second literal array is silent: the union enforces the Record maps'
// exhaustiveness, never an array's, so a third kind reaches only one half.

const { LAPSE_REMINDER_KINDS } = require("../constants")

const FEATURE = path.join(__dirname, "..")
const LEAF = "constants.ts"

// A scan that finds nothing proves nothing. The feature carries more than this.
const SOURCE_FILE_FLOOR = 3

/** Any array literal that lists every kind, in the leaf's order. */
const KINDS_ARRAY = new RegExp(
  `\\[[^\\]]*${LAPSE_REMINDER_KINDS.map((kind) => `"${kind}"`).join(
    "[^\\]]*",
  )}[^\\]]*\\]`,
)

/** Every production source of the feature, the leaf and the tests excluded. */
function featureSources() {
  return fs
    .readdirSync(FEATURE)
    .filter((name) => name.endsWith(".ts") && name !== LEAF)
    .map((name) => path.join(FEATURE, name))
}

describe("the lapse reminder kinds", () => {
  it("reads an array literal the way the rule intends (positive control)", () => {
    expect(KINDS_ARRAY.test('const K = ["day1", "day7"]')).toBe(true)
    expect(KINDS_ARRAY.test('const K = [\n  "day1",\n  "day7",\n]')).toBe(true)
    expect(
      KINDS_ARRAY.test('import { LAPSE_REMINDER_KINDS } from "./constants"'),
    ).toBe(false)
    expect(KINDS_ARRAY.test('const cases = ["a string", "day1"]')).toBe(false)
    expect(KINDS_ARRAY.test('const a = ["day1"]\nconst b = ["day7"]')).toBe(
      false,
    )
  })

  it("declares them once, in the leaf every module already imports", () => {
    expect([...LAPSE_REMINDER_KINDS]).toEqual(["day1", "day7"])

    const files = featureSources()
    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const declaring = files.filter((file) =>
      KINDS_ARRAY.test(fs.readFileSync(file, "utf8")),
    )
    expect(declaring).toEqual([])
  })
})
