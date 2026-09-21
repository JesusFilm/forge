// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (feat-517 KTD5): no layout under `app/` may freeze a blurred screen.
// Home's Recommended for You shelf refetches on a route-segment TRANSITION,
// and a frozen Home stops re-rendering, so `useSegments` never reports the
// return from a watch route and the slate silently stops refreshing.
// `enableFreeze()` is global, so the second scan covers `app/` and `src/`.

const FREEZE_OPTION = /\b(?:freezeOnBlur|enableFreeze)\b/
const GLOBAL_FREEZE = /\benableFreeze\b/

// A comment naming the option is documentation, not a setting. Only a whole
// comment line is stripped, so a trailing `//` cannot hide code before it.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
}

function setsFreezeOption(source) {
  return FREEZE_OPTION.test(stripComments(source))
}

function callsEnableFreeze(source) {
  return GLOBAL_FREEZE.test(stripComments(source))
}

const APP_DIR = path.join(__dirname, "..")
const SRC_DIR = path.join(__dirname, "..", "..", "src")

function walk(dir, keep) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full, keep)
    return keep(entry.name) ? [full] : []
  })
}

const isLayout = (name) => /^_layout(\.[^.]+)?\.tsx?$/.test(name)
const isSource = (name) => /\.tsx?$/.test(name)

// `_layout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/_layout.ios.tsx`,
// `series/_layout.tsx`, `watch/_layout.tsx`. Raise this when a layout is added.
const KNOWN_LAYOUT_COUNT = 5

describe("no layout freezes a blurred screen", () => {
  it.each([
    [
      "a stack screen option",
      `<Stack screenOptions={{ headerShown: false, freezeOnBlur: true }} />`,
    ],
    [
      "a per-screen option",
      `<Stack.Screen name="index" options={{ freezeOnBlur: true }} />`,
    ],
    [
      "a setOptions call",
      `navigation.setOptions({ freezeOnBlur: shouldFreeze })`,
    ],
    ["a shorthand property", `<Tabs screenOptions={{ freezeOnBlur }} />`],
    ["the global switch", `enableFreeze(true)`],
    [
      "the global switch behind an import",
      `import { enableFreeze } from "react-native-screens"`,
    ],
  ])("flags %s (positive control)", (_name, source) => {
    expect(setsFreezeOption(source)).toBe(true)
  })

  it.each([
    ["a comment naming the option", `// never set freezeOnBlur on a layout`],
    [
      "a block comment naming the option",
      `/**\n * enableFreeze would kill the shelf's refresh trigger.\n */`,
    ],
    ["an unrelated screen option", `<Stack screenOptions={{ animation }} />`],
    ["an unrelated identifier", `const frozen = useFrozenRouteState()`],
  ])("does not flag %s (negative control)", (_name, source) => {
    expect(setsFreezeOption(source)).toBe(false)
  })

  it("finds none in the layouts under app/", () => {
    const layouts = walk(APP_DIR, isLayout)
    expect(layouts.length).toBeGreaterThanOrEqual(KNOWN_LAYOUT_COUNT)
    const offenders = layouts.filter((file) =>
      setsFreezeOption(fs.readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })

  it("finds no enableFreeze call in app/ or src/", () => {
    const files = [APP_DIR, SRC_DIR].flatMap((dir) => walk(dir, isSource))
    expect(files.length).toBeGreaterThan(100)
    const offenders = files.filter((file) =>
      callsEnableFreeze(fs.readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
