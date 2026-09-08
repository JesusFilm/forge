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

/** Comments do not run: a commented-out import must not satisfy a positive
 *  pin, and a hand-copied constant must not hide behind one. */
function read(relative) {
  const full = path.join(ROOT, relative)
  expect(fs.existsSync(full)).toBe(true)
  return fs
    .readFileSync(full, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
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
})

/** Whatever TAB_BAR_CONTENT_HEIGHT is assigned, as a bare token. A lookahead
 *  cannot do this job: `\s*` matches zero characters, so the engine can slip
 *  past the space and read the value it was told to reject. */
function assignedValue(source) {
  const m = source.match(/TAB_BAR_CONTENT_HEIGHT\s*=\s*([^\n]+)/)
  return m ? m[1].trim() : null
}

describe("PlaybackHost re-exports rather than re-declaring", () => {
  it("assigns the shared constant and nothing else", () => {
    const value = assignedValue(read("src/components/watch/PlaybackHost.tsx"))
    expect(value).toBe("TAB_BAR_OCCUPIED_HEIGHT")
  })

  it("would reject a hand-copied number in any shape", () => {
    for (const decoy of [
      "export const TAB_BAR_CONTENT_HEIGHT = 68",
      'export const TAB_BAR_CONTENT_HEIGHT = Platform.OS === "ios" ? 68 : 56',
      "export const TAB_BAR_CONTENT_HEIGHT = Platform.select({ ios: 49 })",
    ]) {
      expect(assignedValue(decoy)).not.toBe("TAB_BAR_OCCUPIED_HEIGHT")
    }
  })
})
