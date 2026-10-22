// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and the TypeScript compiler.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")
const ts = require("typescript")

const {
  routeScreenId,
  screenInventory,
} = require("../../release-check/lib/lists")

// Guard (feat-785 U11, KTD11): a release check journey covers a screen only
// by asserting its root `testID="screen-<id>"`. The route file holds the
// literal; when its root view is in a component, it passes the testID prop.
const MOBILE_ROOT = path.join(__dirname, "..", "..")
const APP_DIR = path.join(MOBILE_ROOT, "app")

// The component behind each non-route sheet. A native ActionSheetIOS has no
// view, so it cannot carry a testID.
const SHEET_COMPONENTS = {
  "library-delete-confirm": "src/components/library/DeleteConfirmSheet.tsx",
  "sdui-quiz": "src/components/sections/QuizButtonRenderer.tsx",
  "player-settings": "src/components/watch/PlayerSettingsSheet.tsx",
  "feedback-modal": "src/components/feedback/FeedbackModal.tsx",
}
const VIEWLESS_SHEETS = ["library-delete-action-sheet"]

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return /\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : []
  })
}

/** Every `testID="screen-…"` JSX attribute in the source. The parser, not a
 *  regex, so a comment or another prop cannot satisfy the guard. */
function screenTestIds(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  )
  const ids = []
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "testID" &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text.startsWith("screen-")
    ) {
      ids.push(node.initializer.text.slice("screen-".length))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return ids
}

/** The files that do not carry their own screen's root testID. */
function missingRootTestIds(entries) {
  return entries
    .filter(({ id, file, text }) => !screenTestIds(file, text).includes(id))
    .map(({ id, file }) => `${file} needs testID="screen-${id}"`)
}

function routeEntries() {
  return routeFiles(APP_DIR).flatMap((file) => {
    const relative = path.relative(APP_DIR, file)
    const id = routeScreenId(relative)
    if (id === null) return []
    return [
      { id, file: `app/${relative}`, text: fs.readFileSync(file, "utf8") },
    ]
  })
}

describe("screen root testIDs", () => {
  it("positive control: flags a route with no root testID", () => {
    const file = "app/new-screen.tsx"
    const text = [
      'import { View } from "react-native"',
      '// testID="screen-new-screen"',
      "export default function NewScreen() {",
      '  return <View accessibilityLabel="screen-new-screen" />',
      "}",
    ].join("\n")
    const id = routeScreenId("new-screen.tsx")
    expect(missingRootTestIds([{ id, file, text }])).toEqual([
      'app/new-screen.tsx needs testID="screen-new-screen"',
    ])
  })

  it("positive control: flags a route that carries another screen's id", () => {
    const text = '<LanguageSheet testID="screen-watch-language" />'
    const id = routeScreenId("watch/subtitle.tsx")
    expect(
      missingRootTestIds([{ id, file: "app/watch/subtitle.tsx", text }]),
    ).toEqual(['app/watch/subtitle.tsx needs testID="screen-watch-subtitle"'])
  })

  it("accepts the testID on a host view or as a component prop", () => {
    const text = [
      '<View testID="screen-tab-explore" style={layout.screenContainer} />',
      '<HomeScreen testID="screen-tab-home" />',
    ].join("\n")
    expect(screenTestIds("sample.tsx", text)).toEqual([
      "tab-explore",
      "tab-home",
    ])
  })

  it("every route screen carries its root testID", () => {
    const entries = routeEntries()
    // Anti-vacuous: a wrong root would find no routes and pass.
    expect(entries.length).toBeGreaterThan(20)
    expect(entries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["tab-home", "watch", "watch-language"]),
    )
    expect(missingRootTestIds(entries)).toEqual([])
  })

  it("names the component of every non-route sheet", () => {
    const { sheets } = screenInventory({})
    expect(
      [...Object.keys(SHEET_COMPONENTS), ...VIEWLESS_SHEETS].sort(),
    ).toEqual(sheets)
  })

  it("every non-route sheet with a view carries its root testID", () => {
    const entries = Object.entries(SHEET_COMPONENTS).map(([id, file]) => ({
      id,
      file,
      text: fs.readFileSync(path.join(MOBILE_ROOT, file), "utf8"),
    }))
    expect(missingRootTestIds(entries)).toEqual([])
  })
})
