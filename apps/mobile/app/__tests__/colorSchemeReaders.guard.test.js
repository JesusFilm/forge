// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (feat-699 KTD3, KTD4): the iOS app shows a dark window style, so
// useColorScheme() is always "dark" on iOS. Only usePhoneColorScheme may read
// the color scheme, because it reads the phone's own setting on iOS.
const MOBILE_DIR = path.join(__dirname, "..", "..")
const HOOK = path.join(MOBILE_DIR, "src", "hooks", "usePhoneColorScheme.ts")
const LAYOUT = path.join(MOBILE_DIR, "app", "_layout.tsx")
const APP_JSON = path.join(MOBILE_DIR, "app.json")
const READERS = [
  path.join(MOBILE_DIR, "src", "components", "bible", "BibleReader.tsx"),
  path.join(
    MOBILE_DIR,
    "src",
    "components",
    "bible",
    "sheets",
    "useReaderSheetData.ts",
  ),
]

const COLOR_SCHEME_READ = /\b(?:useColorScheme|getColorScheme)\b/

// A comment that names the hook is documentation, not a read. Only a whole
// comment line is stripped, so a trailing `//` cannot hide code before it.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
}

function readsColorScheme(source) {
  return COLOR_SCHEME_READ.test(stripComments(source))
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [full]
      : []
  })
}

/** The Info.plist dark key makes the window scene report dark too (KTD3). */
function forcesDarkStyle(config) {
  const expo = (config && config.expo) || {}
  const ios = expo.ios || {}
  const infoPlist = ios.infoPlist || {}
  const dark = (value) =>
    typeof value === "string" && value.toLowerCase() === "dark"
  return (
    dark(expo.userInterfaceStyle) ||
    dark(ios.userInterfaceStyle) ||
    dark(infoPlist.UIUserInterfaceStyle)
  )
}

/** True when the module-scope `try` block of the root layout requires the
 *  dark style module and calls it. */
function appliesDarkStyleInGuardedBlock(source) {
  const code = stripComments(source)
  const open = /^try \{$/m.exec(code)
  if (!open) return false
  const close = /^\} catch\b/m.exec(code.slice(open.index))
  if (!close) return false
  const block = code.slice(open.index, open.index + close.index)
  return (
    block.includes('require("../src/lib/appearance/darkInterfaceStyle")') &&
    /\bapplyDarkInterfaceStyle\(\)/.test(block)
  )
}

describe("color scheme readers (feat-699 KTD4)", () => {
  it.each([
    ["an import of the hook", `import { useColorScheme } from "react-native"`],
    ["a call of the hook", `const scheme = useColorScheme()`],
    ["a renamed import", `import { useColorScheme as useScheme } from "rn"`],
    ["an Appearance read", `const scheme = Appearance.getColorScheme()`],
    ["a destructured read", `const { getColorScheme } = Appearance`],
  ])("flags %s (positive control)", (_label, source) => {
    expect(readsColorScheme(source)).toBe(true)
  })

  it.each([
    ["the phone hook", `const scheme = usePhoneColorScheme()`],
    ["a comment line", `// useColorScheme() is always "dark" on iOS`],
    ["a block comment", `/* Appearance.getColorScheme() */`],
    ["the dark style call", `Appearance.setColorScheme("dark")`],
  ])("passes %s (negative control)", (_label, source) => {
    expect(readsColorScheme(source)).toBe(false)
  })

  it("finds no color scheme read in app or src outside usePhoneColorScheme", () => {
    const files = [
      ...sourceFiles(path.join(MOBILE_DIR, "app")),
      ...sourceFiles(path.join(MOBILE_DIR, "src")),
    ]
    // A floor, so a broken walk cannot pass by scanning nothing.
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain(HOOK)
    const offenders = files
      .filter((file) => file !== HOOK)
      .filter((file) => readsColorScheme(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(MOBILE_DIR, file))
    expect(offenders).toEqual([])
  })

  it("sees the read inside usePhoneColorScheme, so the pattern matches real code", () => {
    expect(readsColorScheme(fs.readFileSync(HOOK, "utf8"))).toBe(true)
  })

  it.each(READERS.map((file) => [path.relative(MOBILE_DIR, file), file]))(
    "%s reads the phone setting through usePhoneColorScheme",
    (_label, file) => {
      const code = stripComments(fs.readFileSync(file, "utf8"))
      expect(code).toMatch(/\busePhoneColorScheme\(\)/)
    },
  )
})

describe("the dark interface style (feat-699 KTD3)", () => {
  it("keeps app.json off the dark Info.plist style", () => {
    const config = JSON.parse(fs.readFileSync(APP_JSON, "utf8"))
    expect(forcesDarkStyle(config)).toBe(false)
    expect(config.expo.userInterfaceStyle).toBe("automatic")
  })

  it.each([
    ["the top-level key", true, { expo: { userInterfaceStyle: "dark" } }],
    ["the iOS key", true, { expo: { ios: { userInterfaceStyle: "dark" } } }],
    [
      "the Info.plist key",
      true,
      { expo: { ios: { infoPlist: { UIUserInterfaceStyle: "Dark" } } } },
    ],
    ["automatic", false, { expo: { userInterfaceStyle: "automatic" } }],
    ["no key", false, { expo: {} }],
  ])("reads %s as forced dark: %s", (_label, expected, config) => {
    expect(forcesDarkStyle(config)).toBe(expected)
  })

  it("applies the dark style in the guarded block of app/_layout.tsx", () => {
    expect(
      appliesDarkStyleInGuardedBlock(fs.readFileSync(LAYOUT, "utf8")),
    ).toBe(true)
  })

  const requireLine =
    '  const style = require("../src/lib/appearance/darkInterfaceStyle")'
  it.each([
    [
      "a require and call in the guarded block",
      true,
      `try {\n${requireLine}\n  style.applyDarkInterfaceStyle()\n} catch (e) {}`,
    ],
    [
      "a call after the catch",
      false,
      `try {\n${requireLine}\n} catch (e) {}\napplyDarkInterfaceStyle()`,
    ],
    [
      "a commented-out call",
      false,
      `try {\n${requireLine}\n  // style.applyDarkInterfaceStyle()\n} catch (e) {}`,
    ],
    [
      "a call with no require",
      false,
      `try {\n  applyDarkInterfaceStyle()\n} catch (e) {}`,
    ],
  ])("reads %s as %s", (_label, expected, source) => {
    expect(appliesDarkStyleInGuardedBlock(source)).toBe(expected)
  })
})
