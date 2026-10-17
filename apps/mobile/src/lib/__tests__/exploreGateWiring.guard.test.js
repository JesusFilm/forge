// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The Explore gate (KTD16) holds only while its inputs and readers stay wired.
// jest-expo sets __DEV__, so every render suite sees an open gate, and a suite
// that injects the gate passes whatever the files say. This guard reads sources.

const MOBILE = path.join(__dirname, "..", "..", "..")
const ROOTS = [path.join(MOBILE, "src"), path.join(MOBILE, "app")]

const FLAG = "src/lib/explore/constants.ts"
const BINDER = "src/lib/explore/availability.ts"
const ENV = "src/env.ts"
const IOS_LAYOUT = "app/(tabs)/_layout.ios.tsx"
const ANDROID_LAYOUT = "app/(tabs)/_layout.tsx"
const ROUTE = "app/(tabs)/explore.tsx"

const ENV_NAMES = [
  "EXPO_PUBLIC_EXPLORE_ENABLED",
  "EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED",
]

// The annotation keeps the type wide, as lapseReminders/constants.ts does, so
// the off branch of every reader stays live code.
const FLAG_PATTERN =
  /^export const EXPLORE_ENABLED(?:: boolean)? = (true|false)$/gm

// Any declaration of the name. Narrower than the pattern above on purpose: a
// second declaration is a fault whatever its value shape.
const ANY_DECLARATION = /(?:^|\s)(?:export\s+)?const\s+EXPLORE_ENABLED\b/

// A scan that finds nothing proves nothing. The app carries far more than this.
const SOURCE_FILE_FLOOR = 100

const BINDER_CALL =
  /const EXPLORE_AVAILABLE = resolveExploreAvailable\(\{\s*overTheAirEnabled: EXPLORE_ENABLED,\s*isDev: __DEV__,\s*platform: Platform\.OS,\s*flagValue: env\.EXPO_PUBLIC_EXPLORE_ENABLED,\s*androidFlagValue: env\.EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED,?\s*\}\)/
const BINDER_EXPORT =
  /export function isExploreAvailable\(\): boolean \{\s*return EXPLORE_AVAILABLE\s*\}/

const BINDER_IMPORT =
  /from\s+["'](?:\.\.\/)+src\/lib\/explore\/availability["']/
const IOS_HIDDEN =
  /hidden=\{\s*name === "explore" && !isExploreAvailable\(\)\s*\}/
const ANDROID_HREF =
  /href:\s*isExploreAvailable\(\)\s*\?\s*undefined\s*:\s*null\s*,/
const ROUTE_EARLY_RETURN =
  /if\s*\(\s*!isExploreAvailable\(\)\s*\)\s*return null\b/

/** Comments do not run. The `[^:]` keeps a URL such as `https://` intact. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function read(relativePath) {
  const full = path.join(MOBILE, relativePath)
  expect(fs.existsSync(full)).toBe(true)
  return stripComments(fs.readFileSync(full, "utf8"))
}

function readRaw(relativePath) {
  return fs.readFileSync(path.join(MOBILE, relativePath), "utf8")
}

/** All declarations in a source, so a commented duplicate is visible. */
function readFlags(source) {
  return [...source.matchAll(FLAG_PATTERN)].map((m) => m[1] === "true")
}

/** Every import or require a source pulls in. */
function readImports(source) {
  return [
    ...source.matchAll(/^\s*import\s[\s\S]*?from\s+["'][^"']+["']/gm),
    ...source.matchAll(/^\s*import\s+["'][^"']+["']/gm),
    ...source.matchAll(/\brequire\s*\(/g),
  ].map((m) => m[0].trim())
}

/** Every `.ts`/`.tsx` file under the roots, tests excluded. */
function sourceFiles() {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  for (const root of ROOTS) walk(root)
  return found
}

function relative(full) {
  return path.relative(MOBILE, full).split(path.sep).join("/")
}

/** The group that opens with the last character of `head`, braces matched. */
function bracedGroup(source, head) {
  const start = source.indexOf(head)
  if (start === -1) return null
  const openIndex = start + head.length - 1
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1
    else if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return null
}

/** One `<Tabs.Screen>` declaration, up to the next one or the navigator end. */
function screenBlock(source, name) {
  const head = source.search(new RegExp(`<Tabs\\.Screen\\s+name="${name}"`))
  if (head === -1) return null
  const rest = source.slice(head + 1)
  const next = rest.search(/<Tabs\.Screen\b|<\/Tabs>/)
  return next === -1 ? rest : rest.slice(0, next)
}

// Rule 1: one declaration, on one line, as a bare literal, in a leaf that
// imports nothing, so a reader answers "is it on?" from the file alone.
describe("the Explore over-the-air constant (KTD16)", () => {
  it("parses the flag the way a reader must (positive control)", () => {
    expect(readFlags("export const EXPLORE_ENABLED = false")).toEqual([false])
    expect(readFlags("export const EXPLORE_ENABLED: boolean = true")).toEqual([
      true,
    ])
    // A rewrite that breaks the one-line contract must fail, not default.
    expect(readFlags("export const EXPLORE_ENABLED = !__DEV__")).toEqual([])
    expect(readFlags("const EXPLORE_ENABLED = false")).toEqual([])
    expect(readFlags("export const EXPLORE_ENABLED =\n  false")).toEqual([])
    // A duplicate inside a block comment is what a first-match read would take.
    expect(
      readFlags(
        "/*\nexport const EXPLORE_ENABLED = true\n*/\nexport const EXPLORE_ENABLED = false",
      ),
    ).toEqual([true, false])
  })

  it("declares the flag exactly once, on one line, as a bare literal", () => {
    expect(readFlags(readRaw(FLAG))).toHaveLength(1)
  })

  it("reads imports the way the leaf rule intends (positive control)", () => {
    expect(readImports('import { a } from "./a"')).toHaveLength(1)
    expect(readImports('import {\n  a,\n} from "./a"')).toHaveLength(1)
    expect(readImports('import type { A } from "./a"')).toHaveLength(1)
    expect(readImports('import "./side-effect"')).toHaveLength(1)
    expect(readImports('const a = require("./a")')).toHaveLength(1)
    expect(readImports("export const A = 1")).toHaveLength(0)
  })

  it("keeps the constants file a leaf that imports nothing", () => {
    // Both tab layouts reach this file through the gate. One import here can
    // pull a native module into the navigator.
    expect(readImports(readRaw(FLAG))).toEqual([])
  })

  it("lets no other module declare a constant by the same name", () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const declaring = files
      .filter((file) => ANY_DECLARATION.test(fs.readFileSync(file, "utf8")))
      .map(relative)
    expect(declaring).toEqual([FLAG])
  })

  it("finds a declaration wherever it sits (positive control)", () => {
    expect(ANY_DECLARATION.test("export const EXPLORE_ENABLED = true")).toBe(
      true,
    )
    expect(ANY_DECLARATION.test("  const EXPLORE_ENABLED = true")).toBe(true)
    expect(
      ANY_DECLARATION.test("const EXPLORE_ENABLED_TEMPORARILY = true"),
    ).toBe(false)
    expect(
      ANY_DECLARATION.test("const x = env.EXPO_PUBLIC_EXPLORE_ENABLED"),
    ).toBe(false)
    expect(
      ANY_DECLARATION.test("import { EXPLORE_ENABLED } from './constants'"),
    ).toBe(false)
  })
})

// Rule 2: the binder passes the real inputs, never a literal.
describe("the Explore binder (KTD16)", () => {
  it("binds the rule to the constant, __DEV__, the platform, and both values", () => {
    const source = read(BINDER)
    expect(source).toMatch(BINDER_CALL)
    expect(source).toMatch(BINDER_EXPORT)
    expect(source).not.toMatch(/\b(true|false)\b/)
  })

  it("rejects a binder that drops an input (positive control)", () => {
    const source = read(BINDER)
    expect(source.replace("isDev: __DEV__", "isDev: false")).not.toMatch(
      BINDER_CALL,
    )
    expect(
      source.replace("platform: Platform.OS", 'platform: "ios"'),
    ).not.toMatch(BINDER_CALL)
  })

  // Only the env module and the binder may name the variables, so no reader can
  // skip the over-the-air constant by reading the value directly.
  it("is the only reader of the two variables outside src/env.ts", () => {
    const pattern = /\bEXPO_PUBLIC_EXPLORE_(?:ANDROID_)?ENABLED\b/
    const readers = sourceFiles()
      .filter((file) =>
        pattern.test(stripComments(fs.readFileSync(file, "utf8"))),
      )
      .map(relative)
      .sort()
    expect(readers).toEqual([ENV, BINDER].sort())
  })
})

// Rule 3: no type check catches a missing `_inlined` entry, and Metro inlines
// the value only from module scope. A strict schema stops startup on a typo.
describe.each(ENV_NAMES)("src/env.ts registers %s", (name) => {
  it("names the value in _inlined", () => {
    const group = bracedGroup(read(ENV), "const _inlined = {")
    expect(group).not.toBeNull()
    expect(group).toMatch(new RegExp(`:\\s*process\\.env\\.${name}\\b`))
  })

  it("keeps the client schema a loose optional string", () => {
    const group = bracedGroup(read(ENV), "client: {")
    expect(group).not.toBeNull()
    expect(group.match(new RegExp(`\\b${name}\\b`, "g"))).toHaveLength(1)
    expect(group).toMatch(
      new RegExp(`^\\s*${name}: z\\.string\\(\\)\\.optional\\(\\),\\s*$`, "m"),
    )
  })

  it("names the value in runtimeEnvStrict", () => {
    const group = bracedGroup(read(ENV), "runtimeEnvStrict: {")
    expect(group).not.toBeNull()
    expect(group).toMatch(
      new RegExp(`\\b${name}:\\s*process\\.env\\.${name}\\b`),
    )
  })
})

// Rule 4: both layouts and the route read the binder, never a literal.
describe("the gate readers (KTD16)", () => {
  it("hides the iOS trigger from the binder", () => {
    const source = read(IOS_LAYOUT)
    expect(source).toMatch(BINDER_IMPORT)
    expect(source).toMatch(IOS_HIDDEN)
  })

  it("hides the Android button from the binder, on the Explore screen", () => {
    const source = read(ANDROID_LAYOUT)
    expect(source).toMatch(BINDER_IMPORT)
    const block = screenBlock(source, "explore")
    expect(block).not.toBeNull()
    expect(block).toMatch(ANDROID_HREF)
  })

  // An Android route stays reachable by URL, so the route must check too.
  it("renders nothing from the route while the gate is closed", () => {
    const source = read(ROUTE)
    expect(source).toMatch(BINDER_IMPORT)
    expect(source).toMatch(ROUTE_EARLY_RETURN)
  })

  it("rejects a reader that swaps the binder for a literal (positive control)", () => {
    const ios = read(IOS_LAYOUT)
    expect(ios.replace("!isExploreAvailable()", "false")).not.toMatch(
      IOS_HIDDEN,
    )
    expect('hidden={name === "explore"}').not.toMatch(IOS_HIDDEN)
    expect("hidden={false}").not.toMatch(IOS_HIDDEN)

    const android = screenBlock(read(ANDROID_LAYOUT), "explore")
    expect(android.replace(/href:[^\n]*/, "href: null,")).not.toMatch(
      ANDROID_HREF,
    )
    expect("href: true ? undefined : null,").not.toMatch(ANDROID_HREF)

    const route = read(ROUTE)
    expect(route.replace("!isExploreAvailable()", "false")).not.toMatch(
      ROUTE_EARLY_RETURN,
    )
  })

  it("reads the Explore screen block only (positive control)", () => {
    const decoy = [
      "<Tabs>",
      '<Tabs.Screen name="index" options={{ href: isExploreAvailable() ? undefined : null, }} />',
      '<Tabs.Screen name="explore" options={{ href: null, }} />',
      "</Tabs>",
    ].join("\n")
    expect(screenBlock(decoy, "explore")).not.toMatch(ANDROID_HREF)
    expect(screenBlock(decoy, "index")).toMatch(ANDROID_HREF)
  })
})
