// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: no file in `app/` or `src/` may set a react-native-screens
// `orientation` screen option — expo-screen-orientation then defers to a chain
// the dev client breaks. docs/solutions/integration-issues/expo-screen-orientation-rnscreens-deferral-blocks-fullscreen-rotate.md

// Rule 1 — a react-native-screens orientation VALUE anywhere in the file
// (RNSScreen.mm UIInterfaceOrientationMask:). The gap tolerates a ternary
// across line breaks, and stops at `=` or `;` so a TS annotation stays clear.
const ORIENTATION_VALUE =
  /\borientation:[^=;]{0,120}?["'](default|all|portrait|portrait_up|portrait_down|landscape|landscape_left|landscape_right)["']/

// Rule 2 — an `orientation` KEY of any value shape, but only inside a screen-
// options object. A named constant and a shorthand property carry no literal,
// and `src/lib/watchHome` uses the same key for shelf layout.
const ORIENTATION_KEY = /[{,]\s*orientation\s*(?::|,|\})/

// Where a screen-options object starts. The opening bracket is the LAST
// character of every one of these matches, which is what the scan brace-matches.
const OPTIONS_ANCHORS = [
  /\bsetOptions\s*\(/g,
  /\b(?:screenOptions|options)\s*[:=]\s*\{/g,
]

// Return the bracketed group that starts at `openIndex`, inclusive of both
// brackets. Brace matching beats one large regex here, because a false positive
// blocks CI and an anchored group bounds what Rule 2 can read.
function bracketedGroup(source, openIndex) {
  const open = source[openIndex]
  const close = open === "(" ? ")" : "}"
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) {
      depth += 1
    } else if (source[i] === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return source.slice(openIndex)
}

function setsScreenOrientation(source) {
  if (ORIENTATION_VALUE.test(source)) return true
  return OPTIONS_ANCHORS.some((anchor) => {
    anchor.lastIndex = 0
    let match = anchor.exec(source)
    while (match !== null) {
      const openIndex = match.index + match[0].length - 1
      if (ORIENTATION_KEY.test(bracketedGroup(source, openIndex))) return true
      match = anchor.exec(source)
    }
    return false
  })
}

const APP_DIR = path.join(__dirname, "..")
const SRC_DIR = path.join(__dirname, "..", "..", "src")
const ROOTS = [APP_DIR, SRC_DIR]

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe("no react-native-screens orientation screen option", () => {
  it.each([
    ["an inline literal", `navigation.setOptions({ orientation: "portrait" })`],
    [
      "a JSX literal",
      `<Stack.Screen options={{ orientation: "landscape" }} />`,
    ],
    // The exact form this fix removed, including across line breaks.
    [
      "a ternary of literals",
      `navigation.setOptions({
        orientation: isFullscreen ? "landscape_right" : "portrait",
      })`,
    ],
    [
      "a named constant",
      `navigation.setOptions({ orientation: FULLSCREEN_MASK })`,
    ],
    [
      "a ternary of named constants",
      `navigation.setOptions({
        orientation: isFullscreen ? LANDSCAPE : PORTRAIT,
      })`,
    ],
    [
      "a shorthand property",
      `const orientation = isFullscreen ? "landscape_right" : "portrait"
navigation.setOptions({ orientation })`,
    ],
    [
      "a shorthand property on a stack",
      `<Stack screenOptions={{ headerShown: false, orientation }} />`,
    ],
    [
      "a named constant on an options object",
      `const options = { orientation: FULLSCREEN_MASK }
navigation.setOptions(options)`,
    ],
  ])("flags %s (positive control)", (_name, source) => {
    expect(setsScreenOrientation(source)).toBe(true)
  })

  it.each([
    ["a TypeScript annotation", `const orientation: Orientation = "landscape"`],
    ["a shelf rail", `{ layout: "rail", orientation: "horizontal" }`],
    [
      "a shelf grid",
      `sections.push({ title: "Advent", orientation: "vertical" })`,
    ],
    ["a thumbnail field", `{ orientation: thumbnailOrientation }`],
    [
      "a shelf comparison",
      `section.orientation === "vertical" ? "portrait" : "landscape"`,
    ],
    [
      "an unrelated screen option",
      `navigation.setOptions({ gestureEnabled, headerShown: false })`,
    ],
    [
      "a property read inside options",
      `navigation.setOptions({ headerTitle: shelf.orientation })`,
    ],
    [
      "a callback argument inside options",
      `navigation.setOptions({ onRotate: (orientation) => log(orientation) })`,
    ],
    [
      "an unrelated options object",
      `const shelfOptions = { orientation: "vertical" }`,
    ],
  ])("does not flag %s (negative control)", (_name, source) => {
    expect(setsScreenOrientation(source)).toBe(false)
  })

  it("finds none in app/ or src/", () => {
    const files = ROOTS.flatMap(sourceFiles)
    expect(files.length).toBeGreaterThan(100)
    const offenders = files.filter((file) =>
      setsScreenOrientation(fs.readFileSync(file, "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
