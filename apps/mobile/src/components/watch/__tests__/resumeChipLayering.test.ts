/**
 * The resume chips are hit-testable ONLY as the last sibling. RN plain
 * siblings hit-test in reverse declaration order, so anything declared after
 * them with pointerEvents:"auto" swallows their taps — they still render, so
 * the failure looks like a dead button, not a layout bug.
 *
 * This regressed twice: first behind the full-bleed tap Pressable, then behind
 * the chrome's bottomBar. apps/mobile has no render tests (KTD11), so the
 * order is pinned by source position. Node globals are declared locally
 * rather than via @types/node — KTD11 forbids new test deps.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE: string = fs.readFileSync(
  path.join(__dirname, "..", "VideoPlayer.tsx"),
  "utf8",
)

/** The chips' own block — the `resumeRow` container opens it. */
const CHIPS = "style={playerStyles.resumeRow}"

/**
 * Every sibling that would swallow the chips' taps if declared after them.
 * `PlayerControls` stands in for the chrome layer: its `bottomBar` child is a
 * pointerEvents:"auto" View pinned to bottom:0, and the chips sit at
 * bottom:16 — they overlap, and the chrome mounts visible from frame one.
 */
const MUST_PRECEDE_CHIPS: ReadonlyArray<{ label: string; token: string }> = [
  {
    label: "the full-bleed tap target",
    token: 'accessibilityLabel="Toggle player controls"',
  },
  { label: "the chrome controls layer", token: "<PlayerControls" },
]

function position(token: string): number {
  const index = SOURCE.indexOf(token)
  // A renamed token would silently pass as "not found" on both sides.
  expect(index).toBeGreaterThan(-1)
  return index
}

describe("resume chip layering (hit-test order guard)", () => {
  it.each(MUST_PRECEDE_CHIPS)(
    "declares the chips after $label",
    ({ token }) => {
      expect(position(CHIPS)).toBeGreaterThan(position(token))
    },
  )

  it("declares the chips last, so a new sibling cannot silently bury them", () => {
    // Anything added below the chips inherits the exact bug this file exists
    // for. Adding a sibling after them is allowed only with pointerEvents
    // "none"/"box-none", which this assertion forces you to think about.
    const after = SOURCE.slice(position(CHIPS))
    const closingTags = [...after.matchAll(/^\s{6}<[A-Za-z]/gm)]
    expect(closingTags).toHaveLength(0)
  })
})
