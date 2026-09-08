// Plain JS (like the guards beside it): the RN tsconfig has no Node types, and
// this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The bar's height lives in `src/lib/tabBar.ts`. PlaybackHost used to hand-copy
// it, and both suites that assert on it import it — so the constant cancels out
// on both sides and no behavioural test can see it drift.
const ROOT = path.resolve(__dirname, "../..")
const SHARED_MODULE = /lib\/tabBar["']/

const MUST_IMPORT_THE_SHARED_HEIGHT = [
  ["src/components/watch/PlaybackHost.tsx", /TAB_BAR_OCCUPIED_HEIGHT/],
  ["app/(tabs)/library.tsx", /useTabBarStyle/],
  ["app/(tabs)/_layout.tsx", /useTabBarStyle/],
]

function read(relative) {
  const full = path.join(ROOT, relative)
  expect(fs.existsSync(full)).toBe(true)
  return fs.readFileSync(full, "utf8")
}

describe("the tab bar has one source of truth", () => {
  it.each(MUST_IMPORT_THE_SHARED_HEIGHT)(
    "%s imports it rather than spelling it",
    (relative, symbol) => {
      const source = read(relative)
      expect(source).toMatch(SHARED_MODULE)
      expect(source).toMatch(symbol)
    },
  )

  it("PlaybackHost declares no bare tab-bar height of its own", () => {
    const source = read("src/components/watch/PlaybackHost.tsx")
    // The old shape: `TAB_BAR_CONTENT_HEIGHT = Platform.select({ ios: 49, … })`.
    expect(source).not.toMatch(/TAB_BAR_CONTENT_HEIGHT\s*=\s*Platform\.select/)
  })

  it("the guard is falsifiable — it would catch a hand-copied number", () => {
    const decoy =
      "export const TAB_BAR_CONTENT_HEIGHT = Platform.select({\n  ios: 49,\n})"
    expect(decoy).toMatch(/TAB_BAR_CONTENT_HEIGHT\s*=\s*Platform\.select/)
  })
})
