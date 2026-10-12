// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// feat-694 KTD5: one OTA update turns mirroring off by changing one literal. An
// expression or an import could change at build time, so the guard allows only
// a bare literal, and pins that the controller reads it.
const I18N = path.join(__dirname, "..")
const FLAG = path.join(I18N, "mirroredLayout.ts")
const CONTROLLER = path.join(I18N, "layoutDirection.ts")
const ALIGNMENT = path.join(I18N, "textDirection.ts")

const FLAG_PATTERN = /^export const MIRRORED_LAYOUT_ENABLED = (true|false)$/gm

/** Every declaration in a source, so a commented duplicate is visible. */
function readFlags(source) {
  return [...source.matchAll(FLAG_PATTERN)].map((m) => m[1] === "true")
}

describe("the mirrored layout off switch", () => {
  it("reads only a bare literal (positive control)", () => {
    expect(readFlags("export const MIRRORED_LAYOUT_ENABLED = true")).toEqual([
      true,
    ])
    expect(readFlags("export const MIRRORED_LAYOUT_ENABLED = false")).toEqual([
      false,
    ])
    expect(
      readFlags("export const MIRRORED_LAYOUT_ENABLED = !__DEV__"),
    ).toEqual([])
    expect(
      readFlags('export { MIRRORED_LAYOUT_ENABLED } from "./switches"'),
    ).toEqual([])
    expect(readFlags("export const MIRRORED_LAYOUT_ENABLED = ENABLED")).toEqual(
      [],
    )
    expect(readFlags("const MIRRORED_LAYOUT_ENABLED = true")).toEqual([])
  })

  it("declares the switch exactly once, on one line, as a bare literal", () => {
    const source = fs.readFileSync(FLAG, "utf8")
    expect(readFlags(source)).toHaveLength(1)
    expect(source.match(/MIRRORED_LAYOUT_ENABLED/g)).toHaveLength(1)
  })

  it("passes the switch to the decision, never a literal", () => {
    const controller = fs.readFileSync(CONTROLLER, "utf8")
    expect(controller).toContain(
      'import { MIRRORED_LAYOUT_ENABLED } from "./mirroredLayout"',
    )
    expect(controller).toContain("mirroringEnabled: MIRRORED_LAYOUT_ENABLED,")
    expect(controller).not.toMatch(/mirroringEnabled:\s*(true|false)/)
  })

  // KTD5: the same switch turns off the alignment rule (R9, R10).
  it("has the alignment helper read the switch on both of its paths", () => {
    const helper = fs.readFileSync(ALIGNMENT, "utf8")
    expect(helper).toContain(
      'import { MIRRORED_LAYOUT_ENABLED } from "./mirroredLayout"',
    )
    expect(helper.match(/if \(!MIRRORED_LAYOUT_ENABLED\)/g)).toHaveLength(2)
  })
})
