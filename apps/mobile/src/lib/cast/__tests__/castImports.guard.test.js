// Plain JS (like the other fs-scanning guards): the RN tsconfig has no Node
// types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (KTD3): every react-native-google-cast import stays inside the cast
// layer — src/lib/cast/ (pure logic, plus the thin CastRouteButton.tsx wrapper
// that exists so callers import it instead of the SDK) and useCastPlayback.
const ALLOWED_PREFIX = "src/lib/cast/"
const ALLOWED_FILES = new Set(["src/hooks/useCastPlayback.ts"])

// Quoted specifier, deep imports included — an aliased import still names the
// package on its import line, so this flags aliasing too.
const SDK_IMPORT = /["']react-native-google-cast(\/[^"']*)?["']/

function isAllowed(relative) {
  return relative.startsWith(ALLOWED_PREFIX) || ALLOWED_FILES.has(relative)
}

// Pure detector over [{ relative, content }] so a positive-control fixture can
// prove the mechanism flags a real violation, not just that today's tree is clean.
function findSdkImports(entries) {
  return entries
    .filter((entry) => !isAllowed(entry.relative))
    .filter((entry) =>
      entry.content
        .split("\n")
        .some(
          (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && SDK_IMPORT.test(line),
        ),
    )
    .map((entry) => entry.relative)
}

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("cast SDK imports stay inside the cast layer", () => {
  it("no react-native-google-cast import outside the allowlist", () => {
    const root = path.resolve(__dirname, "../../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    // A broken root resolution or empty scan must not vacuously pass — the real
    // tree has hundreds of source files; assert we actually walked them.
    expect(files.length).toBeGreaterThan(50)
    const entries = files.map((file) => ({
      relative: path.relative(root, file),
      content: fs.readFileSync(file, "utf8"),
    }))
    // Positive control on the REAL tree: the scan must walk the allowlisted
    // dir (the prefix allowlist filters violations, never the walk) and the
    // regex must match at least one real SDK import inside it.
    const castEntries = entries.filter((entry) =>
      entry.relative.startsWith(ALLOWED_PREFIX),
    )
    expect(castEntries.length).toBeGreaterThan(0)
    expect(castEntries.some((entry) => SDK_IMPORT.test(entry.content))).toBe(
      true,
    )
    expect(findSdkImports(entries)).toEqual([])
  })

  it("positive control: the detector flags real violations", () => {
    const offenders = findSdkImports([
      {
        relative: "src/components/watch/Rogue.tsx",
        content: 'import { CastButton } from "react-native-google-cast"',
      },
      {
        relative: "src/components/watch/Deep.tsx",
        content:
          'import CastButton from "react-native-google-cast/lib/commonjs/components/CastButton"',
      },
      {
        relative: "app/watch/rogue.tsx",
        content: 'const cast = require("react-native-google-cast")',
      },
      {
        relative: "src/components/watch/Comment.tsx",
        content: '// mentions "react-native-google-cast" in a comment only',
      },
      {
        relative: "src/lib/cast/castAdapter.ts",
        content: 'import { CastContext } from "react-native-google-cast"',
      },
      {
        relative: "src/hooks/useCastPlayback.ts",
        content: 'import { useCastState } from "react-native-google-cast"',
      },
    ])
    expect(offenders).toEqual([
      "src/components/watch/Rogue.tsx",
      "src/components/watch/Deep.tsx",
      "app/watch/rogue.tsx",
    ])
  })
})
