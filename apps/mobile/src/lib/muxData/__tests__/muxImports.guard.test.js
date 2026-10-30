// Plain JS (like the other fs-scanning guards): the RN tsconfig has no Node
// types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (U2): only the Mux Data layer imports a Mux SDK, `mux-embed`, or the
// local `modules/mux-data` module, for both backends. Every other file goes
// through the gate and the monitor session, so a null gate means no Mux code.
const ALLOWED_PREFIXES = ["src/lib/muxData/", "modules/mux-data/"]

// Quoted specifiers, deep imports included: `mux-embed`, any `@mux/` package,
// and any path that reaches the local module.
const MUX_SPECIFIERS = [
  /["']mux-embed(\/[^"']*)?["']/,
  /["']@mux\/[^"']+["']/,
  /["'](?:[^"']*\/)?modules\/mux-data(\/[^"']*)?["']/,
]

function isAllowed(relative) {
  return ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))
}

function importsMux(content) {
  return content
    .split("\n")
    .some(
      (line) =>
        !/^\s*(\/\/|\*|\/\*)/.test(line) &&
        MUX_SPECIFIERS.some((pattern) => pattern.test(line)),
    )
}

// Pure detector over [{ relative, content }] so a positive-control fixture can
// prove the mechanism flags a real violation, not just that today's tree is clean.
function findMuxImports(entries) {
  return entries
    .filter((entry) => !isAllowed(entry.relative))
    .filter((entry) => importsMux(entry.content))
    .map((entry) => entry.relative)
}

function collectSourceFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("Mux imports stay inside the Mux Data layer", () => {
  it("no Mux import outside the two allowed folders", () => {
    const root = path.resolve(__dirname, "../../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
      ...collectSourceFiles(path.join(root, "modules")),
    ]
    // A broken root resolution or empty scan must not vacuously pass.
    expect(files.length).toBeGreaterThan(100)
    // The walk must reach the Mux Data folder, or the prefix test is untested.
    expect(
      files.some((file) =>
        path.relative(root, file).startsWith(ALLOWED_PREFIXES[0]),
      ),
    ).toBe(true)
    const entries = files.map((file) => ({
      relative: path.relative(root, file).split(path.sep).join("/"),
      content: fs.readFileSync(file, "utf8"),
    }))
    expect(findMuxImports(entries)).toEqual([])
  })

  it("positive control: the detector flags real violations", () => {
    const offenders = findMuxImports([
      {
        relative: "src/components/watch/Rogue.tsx",
        content: 'import mux from "mux-embed"',
      },
      {
        relative: "src/hooks/Deep.ts",
        content: 'const mux = require("mux-embed/dist/mux.js")',
      },
      {
        relative: "app/watch/rogue.tsx",
        content: 'import { MuxVideo } from "@mux/mux-video-react"',
      },
      {
        relative: "src/hooks/useRogue.ts",
        content: 'import { attach } from "../../modules/mux-data"',
      },
      {
        relative: "src/components/watch/Comment.tsx",
        content: '// mentions "mux-embed" in a comment only',
      },
      {
        relative: "src/lib/muxThumbnail.ts",
        content: 'const host = "image.mux.com"',
      },
      {
        relative: "src/lib/muxData/embedMonitor.ts",
        content: 'import mux from "mux-embed"',
      },
      {
        relative: "src/lib/muxData/nativeMonitor.ts",
        content: 'import { ForgeMuxData } from "../../../modules/mux-data"',
      },
      {
        relative: "modules/mux-data/index.ts",
        content: 'import { requireOptionalNativeModule } from "expo"',
      },
    ])
    expect(offenders).toEqual([
      "src/components/watch/Rogue.tsx",
      "src/hooks/Deep.ts",
      "app/watch/rogue.tsx",
      "src/hooks/useRogue.ts",
    ])
  })
})
