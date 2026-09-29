// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (KTD3): the locale resolves in the guarded block of app/_layout.tsx,
// before the first render. Only the store loads expo-localization, lazily in
// `try`, so a dev client without the native module stays on English.
const MOBILE_DIR = path.join(__dirname, "..", "..")
const LAYOUT = path.join(MOBILE_DIR, "app", "_layout.tsx")
const STORE = path.join(MOBILE_DIR, "src", "i18n", "localeStore.ts")
const LISTENER_MODULE = "expo-localization/build/ExpoLocalization"

// Returns [code, masked], both index-aligned with the source: `code` blanks
// comments, and `masked` also blanks string contents, so a brace in a string
// cannot unbalance a block.
function scan(source) {
  let code = ""
  let masked = ""
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === "/" && (next === "/" || next === "*")) {
      const end =
        next === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2) + 2
      const stop = end <= 0 || end < i ? source.length : end
      const blank = source.slice(i, stop).replace(/[^\n]/g, " ")
      code += blank
      masked += blank
      i = stop
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j += 1
        j += 1
      }
      const literal = source.slice(i, j + 1)
      code += literal
      masked += c + literal.slice(1, -1).replace(/[^\n]/g, " ") + c
      i = j + 1
      continue
    }
    code += c
    masked += c
    i += 1
  }
  return [code, masked]
}

/** [start, end] of every `try { … }` body, with its brace depth. */
function tryBlocks(masked) {
  const blocks = []
  const pattern = /\btry\s*\{/g
  let match
  while ((match = pattern.exec(masked)) != null) {
    const open = match.index + match[0].length - 1
    let depth = 0
    for (let k = 0; k < open; k += 1) {
      if (masked[k] === "{") depth += 1
      else if (masked[k] === "}") depth -= 1
    }
    let level = 0
    let close = -1
    for (let k = open; k < masked.length; k += 1) {
      if (masked[k] === "{") level += 1
      else if (masked[k] === "}" && (level -= 1) === 0) {
        close = k
        break
      }
    }
    if (close > 0) blocks.push({ start: open, end: close, depth })
  }
  return blocks
}

function indexesOf(code, needle) {
  const found = []
  let at = code.indexOf(needle)
  while (at !== -1) {
    found.push(at)
    at = code.indexOf(needle, at + 1)
  }
  return found
}

const inside = (blocks, index) =>
  blocks.some((block) => index > block.start && index < block.end)

// A value import of the specifier or a subpath. The clause excludes quotes,
// so a match cannot run on into the next statement (the code has no `;`).
function staticImportOf(code, specifier) {
  const matches = (from) =>
    from === specifier || from.startsWith(`${specifier}/`)
  const bare = /^[ \t]*import\s+["']([^"']+)["']/gm
  for (const [, from] of code.matchAll(bare)) if (matches(from)) return true
  const named = /^[ \t]*import\s+([^"';]*?)\bfrom\s+["']([^"']+)["']/gm
  for (const [, clause, from] of code.matchAll(named)) {
    if (!/^type\b/.test(clause.trim()) && matches(from)) return true
  }
  return false
}

/** True when a module-scope `try` block requires the store and starts it. */
function startsLocaleSyncInGuardedBlock(source) {
  const [code, masked] = scan(source)
  if (staticImportOf(code, "../src/i18n/localeStore")) return false
  const guarded = tryBlocks(masked).filter((block) => block.depth === 0)
  const calls = indexesOf(code, "startLocaleSync(")
  const requires = indexesOf(code, 'require("../src/i18n/localeStore")')
  return (
    calls.some((index) => inside(guarded, index)) &&
    requires.some((index) => inside(guarded, index))
  )
}

/** True when RootLayout's own body calls useLocaleResolutionLog(hydrated). */
function logsLocaleInRootLayout(source) {
  const [code, masked] = scan(source)
  const head = /export default function RootLayout\([^)]*\)\s*\{/.exec(masked)
  if (!head) return false
  const open = head.index + head[0].length - 1
  let level = 0
  for (let k = open; k < masked.length; k += 1) {
    if (masked[k] === "{") level += 1
    else if (masked[k] === "}" && (level -= 1) === 0) {
      return code.slice(open, k).includes("useLocaleResolutionLog(hydrated)")
    }
  }
  return false
}

/** True when every load of `specifier` is a require inside a `try` block. */
function loadsOnlyInsideTry(source, specifier) {
  const [code, masked] = scan(source)
  if (staticImportOf(code, specifier)) return false
  const blocks = tryBlocks(masked)
  const loads = indexesOf(code, `require("${specifier}")`)
  return loads.length > 0 && loads.every((index) => inside(blocks, index))
}

/** A runtime load of expo-localization; type-only imports do not count. */
function loadsExpoLocalization(source) {
  const [code] = scan(source)
  return (
    staticImportOf(code, "expo-localization") ||
    /\brequire\(\s*["']expo-localization(?:\/[^"']*)?["']/.test(code) ||
    /(?<!typeof\s)\bimport\(\s*["']expo-localization/.test(code)
  )
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "__tests__") return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe("UI locale start-up order (KTD3)", () => {
  it("starts the locale store inside the guarded block of app/_layout.tsx", () => {
    const source = fs.readFileSync(LAYOUT, "utf8")
    expect(startsLocaleSyncInGuardedBlock(source)).toBe(true)
  })

  it("accepts a guarded require and call (positive control)", () => {
    const source = [
      "try {",
      '  const store = require("../src/i18n/localeStore")',
      "  store.startLocaleSync()",
      "} catch (e) {}",
    ].join("\n")
    expect(startsLocaleSyncInGuardedBlock(source)).toBe(true)
  })

  it.each([
    [
      "a call after the catch",
      'try {\n  const s = require("../src/i18n/localeStore")\n} catch (e) {}\nstartLocaleSync()',
    ],
    [
      "a call in a comment",
      'try {\n  require("../src/i18n/localeStore")\n  // startLocaleSync()\n} catch (e) {}',
    ],
    [
      "a call in the catch block",
      'try {\n  require("../src/i18n/localeStore")\n} catch (e) {\n  startLocaleSync()\n}',
    ],
    [
      "a static import of the store",
      'import { startLocaleSync } from "../src/i18n/localeStore"\ntry {\n  require("../src/i18n/localeStore")\n  startLocaleSync()\n} catch (e) {}',
    ],
    [
      "a call inside a function's try",
      'function boot() {\n  try {\n    require("../src/i18n/localeStore").startLocaleSync()\n  } catch (e) {}\n}',
    ],
  ])("rejects %s (negative control)", (_label, source) => {
    expect(startsLocaleSyncInGuardedBlock(source)).toBe(false)
  })
})

// The hook's own suite renders its own root, so only this pins the call site.
describe("the ui_locale.resolved log", () => {
  it("is called from RootLayout with the hydration flag", () => {
    expect(logsLocaleInRootLayout(fs.readFileSync(LAYOUT, "utf8"))).toBe(true)
  })

  it.each([
    [
      "the call",
      "export default function RootLayout() {\n  useLocaleResolutionLog(hydrated)\n}",
      true,
    ],
    [
      "a commented-out call",
      "export default function RootLayout() {\n  // useLocaleResolutionLog(hydrated)\n}",
      false,
    ],
    [
      "a call outside RootLayout",
      "function Other() {\n  useLocaleResolutionLog(hydrated)\n}\nexport default function RootLayout() {}",
      false,
    ],
  ])("reads %s as %s", (_label, source, expected) => {
    expect(logsLocaleInRootLayout(source)).toBe(expected)
  })
})

describe("expo-localization loading (KTD3)", () => {
  it("requires the listener module and the public entry only inside try", () => {
    const source = fs.readFileSync(STORE, "utf8")
    expect(loadsOnlyInsideTry(source, LISTENER_MODULE)).toBe(true)
    expect(loadsOnlyInsideTry(source, "expo-localization")).toBe(true)
  })

  it.each([
    [
      "a require outside try",
      `const m = require("${LISTENER_MODULE}")\ntry {\n  m.addLocaleListener(f)\n} catch {}`,
    ],
    [
      "a static import",
      `import { addLocaleListener } from "${LISTENER_MODULE}"\ntry {\n  require("${LISTENER_MODULE}")\n} catch {}`,
    ],
    [
      "a require only in a comment",
      `try {\n  // require("${LISTENER_MODULE}")\n} catch {}`,
    ],
  ])("rejects %s (negative control)", (_label, source) => {
    expect(loadsOnlyInsideTry(source, LISTENER_MODULE)).toBe(false)
  })

  it("pins the listener path to a module that exports addLocaleListener", () => {
    const resolved = require.resolve(LISTENER_MODULE, { paths: [MOBILE_DIR] })
    const native = path.join(
      path.dirname(resolved),
      "ExpoLocalization.native.js",
    )
    expect(fs.readFileSync(native, "utf8")).toMatch(
      /export function addLocaleListener\b/,
    )
  })

  it("still needs the deep path: the public entry does not export the listener", () => {
    // If a bump exports it publicly, switch the store to the public entry.
    const entry = require.resolve("expo-localization", { paths: [MOBILE_DIR] })
    expect(fs.readFileSync(entry, "utf8")).not.toMatch(
      /export\s+(?:function\s+addLocaleListener|\{[^}]*\baddLocaleListener\b)/,
    )
  })

  it("finds no expo-localization load outside the store", () => {
    const files = [
      ...sourceFiles(path.join(MOBILE_DIR, "app")),
      ...sourceFiles(path.join(MOBILE_DIR, "src")),
    ]
    // A floor, so a broken walk cannot pass by scanning nothing.
    expect(files.length).toBeGreaterThan(100)
    const offenders = files
      .filter((file) => file !== STORE)
      .filter((file) => loadsExpoLocalization(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(MOBILE_DIR, file))
    expect(offenders).toEqual([])
  })

  it.each([
    [`import { getLocales } from "expo-localization"`, true],
    [`import {\n  getLocales,\n} from "expo-localization"`, true],
    [`import "expo-localization"`, true],
    [`const l = require("expo-localization")`, true],
    [`await import("expo-localization")`, true],
    [`import type { Locale } from "expo-localization"`, false],
    [
      `import { A } from "a"\nimport type { L } from "expo-localization"`,
      false,
    ],
    [`type L = typeof import("expo-localization")`, false],
  ])("classifies %j as a load: %s (controls)", (source, expected) => {
    expect(loadsExpoLocalization(source)).toBe(expected)
  })
})
