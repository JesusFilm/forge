// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// KTD3: `configureDownloadEngine` mutates ONE app-wide native session. The
// export runs beside live offline downloads, so a configure from the export
// path tears that session down and cancels every one of them.
const ENGINE_GLOBAL_CONFIG = /\b(?:configureDownloadEngine|setConfig)\s*\(/g

// The export path's roots. Every one must resolve — a root the reader cannot
// find used to be skipped, so a rename could shrink the walk in silence.
const EXPORT_ROOTS = [
  "src/lib/rawExport.ts",
  "src/lib/rawExportAdapter.ts",
  "src/lib/transferPort.ts",
  "src/lib/exportSession.ts",
  "src/lib/rawExportRun.ts",
  "src/lib/exportSweep.ts",
  "src/lib/exportReport.ts",
  "src/lib/rawExportConstants.ts",
  "src/components/ExportReportHost.tsx",
  // The composition root is the ONLY export file that holds the engine at all,
  // so a fence that skipped it would be blind exactly where the risk is.
  "src/lib/rawExportRuntime.ts",
]

const FENCE_EXEMPT = new Set([
  // Declares the global configure. The fence is about its CALLERS, and this is
  // the ONLY exemption: `DownloadsProvider` held one until the call-site pin at
  // the foot of this file, and that exemption is what left the single line
  // holding KTD3 unguarded.
  "src/lib/downloadEngine.ts",
])

// Blank comments and string CONTENT so a token in prose or in a literal cannot
// flag; `${…}` expressions stay live, because a call there is still a call.
// LIMIT: a regex literal holding one quote would desynchronize this.
function stripCommentsAndStrings(src) {
  const blank = (ch) => (ch === "\n" ? "\n" : " ")
  const templates = []
  let out = ""
  let depth = 0
  let mode = "code"
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (mode === "code") {
      if (c === "\\") {
        out += "  "
        i += 2
        continue
      }
      if (c === "/" && n === "/") {
        mode = "line"
        out += "  "
        i += 2
        continue
      }
      if (c === "/" && n === "*") {
        mode = "block"
        out += "  "
        i += 2
        continue
      }
      if (c === "'" || c === '"' || c === "`") {
        mode = c === "`" ? "tpl" : "quoted"
        out += c
        i++
        continue
      }
      if (c === "{") depth++
      if (c === "}") {
        if (depth === 0 && templates.length > 0) {
          depth = templates.pop()
          mode = "tpl"
          out += " "
          i++
          continue
        }
        depth--
      }
      out += c
      i++
      continue
    }
    if (mode === "line") {
      if (c === "\n") mode = "code"
      out += c === "\n" ? "\n" : " "
      i++
      continue
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code"
        out += "  "
        i += 2
        continue
      }
      out += blank(c)
      i++
      continue
    }
    if (c === "\\") {
      out += "  "
      i += 2
      continue
    }
    if (mode === "quoted") {
      if (c === "'" || c === '"' || c === "`") {
        mode = "code"
        out += c
        i++
        continue
      }
      out += blank(c)
      i++
      continue
    }
    if (c === "`") {
      mode = "code"
      out += c
      i++
      continue
    }
    if (c === "$" && n === "{") {
      templates.push(depth)
      depth = 0
      mode = "code"
      out += "  "
      i += 2
      continue
    }
    out += blank(c)
    i++
  }
  return out
}

// Value edges only. `import type` erases at runtime, so a type-only reference
// to the engine's own types is not a path to its global configure — which is
// precisely the posture transferPort.ts documents at its head.
const VALUE_IMPORT = /^[ \t]*import\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm
const VALUE_REEXPORT =
  /^[ \t]*export\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*["']([^"']+)["']/gm
const LAZY_REQUIRE = /\brequire\(\s*["']([^"']+)["']\s*\)/g

/** Every relative module the given source pulls in at RUNTIME. */
function valueEdges(source) {
  const specs = []
  for (const re of [
    VALUE_IMPORT,
    VALUE_REEXPORT,
    SIDE_EFFECT_IMPORT,
    LAZY_REQUIRE,
  ]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source)) != null) {
      if (m[1].startsWith(".")) specs.push(m[1])
    }
  }
  return specs
}

/**
 * Transitive runtime closure of `roots`. `readFile(relative)` returns the
 * source or null, and `resolve(fromRelative, spec)` returns a repo-relative
 * path or null — both injected so a control can starve the walk.
 */
function reachableFrom(roots, readFile, resolve) {
  const seen = []
  const queue = roots.slice()
  while (queue.length > 0) {
    const rel = queue.shift()
    if (seen.includes(rel)) continue
    const source = readFile(rel)
    if (source == null) continue
    seen.push(rel)
    for (const spec of valueEdges(source)) {
      const next = resolve(rel, spec)
      if (next != null && !seen.includes(next)) queue.push(next)
    }
  }
  return seen.sort()
}

/** Pure detector over [{ relative, content }] so controls prove each branch. */
function findEngineConfigCalls(entries) {
  const hits = []
  for (const entry of entries) {
    if (FENCE_EXEMPT.has(entry.relative)) continue
    const code = stripCommentsAndStrings(entry.content)
    ENGINE_GLOBAL_CONFIG.lastIndex = 0
    let m
    while ((m = ENGINE_GLOBAL_CONFIG.exec(code)) != null) {
      hits.push(`${entry.relative}: ${m[0].replace(/\s*\($/, "")}`)
    }
  }
  return hits.sort()
}

const APP_ROOT = path.resolve(__dirname, "../../..")

function readSource(relative) {
  const full = path.join(APP_ROOT, relative)
  if (!fs.existsSync(full)) return null
  return fs.readFileSync(full, "utf8")
}

function resolveRelative(fromRelative, spec) {
  const base = path.resolve(
    path.dirname(path.join(APP_ROOT, fromRelative)),
    spec,
  )
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate)) return path.relative(APP_ROOT, candidate)
  }
  return null
}

// A broken walk must not pass by scanning nothing. The closure is 20 files
// today and only grows, so a floor of 12 leaves room without going vacuous.
const REACHABLE_FLOOR = 12

describe("no export-path module configures the download engine", () => {
  const reachable = reachableFrom(EXPORT_ROOTS, readSource, resolveRelative)

  it("every listed root resolves", () => {
    // Membership, not a count. A root that no longer exists must fail here
    // rather than drop out of the walk and shrink the fence.
    expect(EXPORT_ROOTS.filter((rel) => readSource(rel) == null)).toEqual([])
    for (const root of EXPORT_ROOTS) expect(reachable).toContain(root)
  })

  it("the scan reaches real export code and the engine seam", () => {
    expect(reachable.length).toBeGreaterThanOrEqual(REACHABLE_FLOOR)
    expect(reachable).toContain("src/lib/rawExportAdapter.ts")
    expect(reachable).toContain("src/lib/transferPort.ts")
    expect(reachable).toContain("src/lib/rawExportRuntime.ts")
    // The walk must actually arrive at the engine, or the fence guards nothing.
    expect(reachable).toContain("src/lib/downloadEngine.ts")
  })

  it("the floor fails when the scan matches nothing", () => {
    const starved = reachableFrom(EXPORT_ROOTS, () => null, resolveRelative)
    expect(starved).toEqual([])
    expect(starved.length).toBeLessThan(REACHABLE_FLOOR)
  })

  it("no reachable module calls the engine's global configure", () => {
    const entries = reachable.map((relative) => ({
      relative,
      content: readSource(relative),
    }))
    expect(entries.length).toBeGreaterThanOrEqual(REACHABLE_FLOOR)
    expect(findEngineConfigCalls(entries)).toEqual([])
  })

  it("positive control: a configure call in an export module is flagged", () => {
    expect(
      findEngineConfigCalls([
        {
          relative: "src/lib/rawExportAdapter.ts",
          content: `configureDownloadEngine({ wifiOnly: input.wifiOnly })`,
        },
        {
          relative: "src/lib/transferPort.ts",
          content: `deps.setConfig({ allowsCellularAccess: true })`,
        },
      ]),
    ).toEqual([
      "src/lib/rawExportAdapter.ts: configureDownloadEngine",
      "src/lib/transferPort.ts: setConfig",
    ])
  })

  it("positive control: the provider's own direct configure is flagged", () => {
    // It used to be exempt. The exemption made the revert invisible, so the
    // provider is now scanned like every other caller.
    expect(
      findEngineConfigCalls([
        {
          relative: "src/contexts/DownloadsProvider.tsx",
          content: `configureDownloadEngine({ wifiOnly })`,
        },
      ]),
    ).toEqual(["src/contexts/DownloadsProvider.tsx: configureDownloadEngine"])
  })

  it("negative control: the declaring module, and a bare reference, pass", () => {
    expect(
      findEngineConfigCalls([
        {
          relative: "src/lib/downloadEngine.ts",
          content: `export function configureDownloadEngine(o) { setConfig(o) }`,
        },
        // Handing the engine to the fence is the permitted shape: a reference,
        // never a call. The fence decides WHEN it runs.
        {
          relative: "src/contexts/DownloadsProvider.tsx",
          content: `const fence = createEngineConfigFence({ configure: configureDownloadEngine, session })`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: the call named in prose or in a string is not flagged", () => {
    expect(
      findEngineConfigCalls([
        {
          relative: "src/lib/rawExport.ts",
          content: `// never call configureDownloadEngine(...) from here\nconst note = "configureDownloadEngine("`,
        },
      ]),
    ).toEqual([])
  })

  it("value edges exclude type-only imports and include lazy requires", () => {
    // The whole fence rests on this split: a type-only edge is erased, so it
    // is not a path to the engine, while a lazy require certainly is.
    expect(
      valueEdges(
        [
          `import type { EngineTask } from "./downloadEngine"`,
          `export type { Foo } from "./types"`,
          `import { copyFile } from "./offlineFileSystem"`,
          `export { buildExportTaskId } from "./rawExport"`,
          `import "./sideEffect"`,
          `const engine = require("./downloadEngine")`,
          `import MediaLibrary from "expo-media-library"`,
        ].join("\n"),
      ).sort(),
    ).toEqual([
      "./downloadEngine",
      "./offlineFileSystem",
      "./rawExport",
      "./sideEffect",
    ])
  })
})

// The closure scan above proves no export MODULE names the configure call. It
// cannot prove the invariant, because the invariant is about a line that lives
// OUTSIDE the closure: the provider's wifi-only effect is the only thing that
// configures the engine at all, and routing it through the fence is what stops
// a mid-export toggle. That is a one-line revert, and it typechecks.
const PROVIDER = "src/contexts/DownloadsProvider.tsx"
const FENCE_APPLY = "engineFenceRef.current?.setWifiOnly(wifiOnly)"
const DIRECT_CONFIGURE = "configureDownloadEngine({ wifiOnly })"

describe("the wifi-only preference reaches the engine only through the fence", () => {
  const source = readSource(PROVIDER)

  it("the provider builds the fence and applies the preference to it", () => {
    expect(source).not.toBeNull()
    expect(source).toContain("createEngineConfigFence({")
    // The engine is handed to the fence as a REFERENCE. That is the permitted
    // shape, and pinning it keeps the absence check below from going vacuous.
    expect(source).toContain("configure: configureDownloadEngine,")
    expect(source).toContain(FENCE_APPLY)
  })

  it("the provider holds no direct configure CALL", () => {
    expect(
      findEngineConfigCalls([{ relative: PROVIDER, content: source }]),
    ).toEqual([])
  })

  it("the one-line revert to a direct configure is flagged", () => {
    const reverted = source.replace(FENCE_APPLY, DIRECT_CONFIGURE)
    expect(reverted).not.toBe(source)
    expect(
      findEngineConfigCalls([{ relative: PROVIDER, content: reverted }]),
    ).toEqual([`${PROVIDER}: configureDownloadEngine`])
  })
})
