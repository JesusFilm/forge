// Plain JS (like the other guard suites here): the RN tsconfig has no Node
// types, and this guard reads sources off disk and walks the source tree.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// KTD12: the app's push gate is a build-time constant in a dependency-free
// leaf, so it flips by OTA update alone. Three properties hold that shape, and
// no behavioural suite ties them together — a suite that injects the gate as a
// parameter passes whatever the file says.
//
//   1. The gate is declared once, on one line, as a bare literal, so a reader
//      can answer "is it on?" from the file and nothing else decides it.
//   2. The constants file imports nothing, so no consumer can pull a native
//      module in through it.
//   3. No other module declares a constant by the same name, which is the
//      one-line revert surface a second declaration would open.
//
// Copied from lapseRemindersKillSwitch.guard.test.js on purpose: the two gates
// are independent levers and each one needs its own proof.

const MOBILE = path.join(__dirname, "..", "..", "..")
const FLAG = path.join(MOBILE, "src", "lib", "push", "constants.ts")
const ROOTS = [path.join(MOBILE, "src"), path.join(MOBILE, "app")]

// The annotation is optional and deliberate: `: boolean` keeps the type wide,
// so a consumer's off branch stays live code rather than an unreachable one.
const FLAG_PATTERN =
  /^export const PUSH_REGISTRATION_ENABLED(?:: boolean)? = (true|false)$/gm

// Any declaration of the name, wherever it sits. Narrower than the pattern
// above on purpose: a second declaration is a fault whatever its value shape.
const ANY_DECLARATION =
  /(?:^|\s)(?:export\s+)?const\s+PUSH_REGISTRATION_ENABLED\b/

// A scan that finds nothing proves nothing. The app carries far more than this.
const SOURCE_FILE_FLOOR = 100

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

describe("the push registration kill-switch", () => {
  it("parses the flag the way a reader must (positive control)", () => {
    expect(readFlags("export const PUSH_REGISTRATION_ENABLED = false")).toEqual(
      [false],
    )
    expect(
      readFlags("export const PUSH_REGISTRATION_ENABLED: boolean = true"),
    ).toEqual([true])
    // A rewrite that breaks the one-line contract must fail, not default.
    expect(
      readFlags("export const PUSH_REGISTRATION_ENABLED = !__DEV__"),
    ).toEqual([])
    expect(readFlags("const PUSH_REGISTRATION_ENABLED = false")).toEqual([])
    expect(
      readFlags("export const PUSH_REGISTRATION_ENABLED =\n  false"),
    ).toEqual([])
    // A duplicate inside a block comment is what a first-match read would take.
    expect(
      readFlags(
        "/* export const PUSH_REGISTRATION_ENABLED = true */\nexport const PUSH_REGISTRATION_ENABLED = false",
      ),
    ).toEqual([false])
    expect(
      readFlags(
        "/*\nexport const PUSH_REGISTRATION_ENABLED = true\n*/\nexport const PUSH_REGISTRATION_ENABLED = false",
      ),
    ).toEqual([true, false])
  })

  it("declares the flag exactly once, on one line, as a bare literal", () => {
    expect(readFlags(fs.readFileSync(FLAG, "utf8"))).toHaveLength(1)
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
    // The Profile row reads this file too, and that screen must never reach
    // the notifications adapter. One import here can open that path.
    expect(readImports(fs.readFileSync(FLAG, "utf8"))).toEqual([])
  })

  it("lets no other module declare a constant by the same name", () => {
    const files = sourceFiles()

    expect(files.length).toBeGreaterThan(SOURCE_FILE_FLOOR)
    const declaring = files.filter((file) =>
      ANY_DECLARATION.test(fs.readFileSync(file, "utf8")),
    )
    expect(declaring).toEqual([FLAG])
  })

  it("finds a declaration wherever it sits (positive control)", () => {
    expect(
      ANY_DECLARATION.test("export const PUSH_REGISTRATION_ENABLED = true"),
    ).toBe(true)
    expect(
      ANY_DECLARATION.test("  const PUSH_REGISTRATION_ENABLED = true"),
    ).toBe(true)
    expect(
      ANY_DECLARATION.test(
        "const PUSH_REGISTRATION_ENABLED_TEMPORARILY = true",
      ),
    ).toBe(false)
    expect(
      ANY_DECLARATION.test("import { PUSH_REGISTRATION_ENABLED } from './c'"),
    ).toBe(false)
  })
})
