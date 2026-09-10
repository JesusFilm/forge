// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// R12/R14: a saved file belongs to the device library, not to the offline
// library, and it is never a Download Record. Both hold by ABSENCE, so nothing
// in the export's own tests can go red when one starts writing offline state.
const MANIFEST_WRITES = [
  "writeRecord",
  "removeRecord",
  "serializeOfflineRecord",
  "serializeOfflineIndex",
  "offlineRecordKey",
  "OFFLINE_INDEX_STORAGE_KEY",
]

// The second half of the same rule: a key-value write that names the offline
// namespace reaches the manifest without naming any symbol above.
const STORAGE_WRITE =
  /\b(?:setItem|multiSet|mergeItem|removeItem|multiRemove)\s*\(/g
const OFFLINE_KEY = /offline/i

// The export path, in full. `rawExportRuntime.ts` is here because it is the
// ONE export file that holds AsyncStorage at all, so it is where an offline
// write would actually be reachable. `exportReport.ts` keeps the list whole.
const EXPORT_MODULES = [
  "src/lib/rawExport.ts",
  "src/lib/rawExportAdapter.ts",
  "src/lib/transferPort.ts",
  "src/lib/exportSession.ts",
  "src/lib/rawExportRun.ts",
  "src/lib/exportSweep.ts",
  "src/lib/exportReport.ts",
  "src/lib/rawExportConstants.ts",
  "src/lib/rawExportRuntime.ts",
  "src/components/ExportReportHost.tsx",
]

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

// Index just past the bracket at `open`'s match. null if unbalanced.
function balancedEnd(src, open) {
  const PAIRS = { "(": ")", "{": "}", "[": "]" }
  const stack = [PAIRS[src[open]]]
  let i = open + 1
  while (i < src.length) {
    const c = src[i]
    if (PAIRS[c]) {
      stack.push(PAIRS[c])
      i++
      continue
    }
    if (c === ")" || c === "}" || c === "]") {
      if (stack[stack.length - 1] !== c) return null
      stack.pop()
      if (stack.length === 0) return i
      i++
      continue
    }
    i++
  }
  return null
}

/** Pure detector over [{ relative, content }] so controls prove each branch. */
function findManifestWrites(entries) {
  const hits = []
  for (const entry of entries) {
    const code = stripCommentsAndStrings(entry.content)
    for (const symbol of MANIFEST_WRITES) {
      if (new RegExp(`\\b${symbol}\\b`).test(code)) {
        hits.push(`${entry.relative}: ${symbol}`)
      }
    }
    STORAGE_WRITE.lastIndex = 0
    while (STORAGE_WRITE.exec(code) != null) {
      const open = STORAGE_WRITE.lastIndex - 1
      const end = balancedEnd(code, open)
      // The key is DATA, so read the original text: the stripper blanks the
      // one place `"offline.record.x"` is legible. Indices align because the
      // stripper preserves length, which its own test pins.
      if (end != null && OFFLINE_KEY.test(entry.content.slice(open, end))) {
        hits.push(`${entry.relative}: offline storage write`)
      }
    }
  }
  return Array.from(new Set(hits)).sort()
}

const APP_ROOT = path.resolve(__dirname, "../../..")

function readSource(relative) {
  const full = path.join(APP_ROOT, relative)
  if (!fs.existsSync(full)) return null
  return fs.readFileSync(full, "utf8")
}

function collectEntries(read) {
  const entries = []
  for (const relative of EXPORT_MODULES) {
    const content = read(relative)
    if (content == null) continue
    entries.push({ relative, content })
  }
  return entries
}

describe("no export module writes offline state", () => {
  const entries = collectEntries(readSource)

  it("the scan reads EVERY listed export module", () => {
    // Membership, not a count. Under a count-only floor `transferPort.ts`
    // could vanish — the module holding every staging write — and this suite
    // stayed green. A rename during a refactor does exactly that.
    expect(entries.map((entry) => entry.relative)).toEqual(EXPORT_MODULES)
    for (const entry of entries) {
      expect(entry.content.length).toBeGreaterThan(200)
      expect(entry.content).toContain("export")
    }
  })

  it("a starved reader is caught, not tolerated", () => {
    const starved = collectEntries(() => null)
    expect(starved).toEqual([])
    expect(starved.map((entry) => entry.relative)).not.toEqual(EXPORT_MODULES)
  })

  it("no export module touches the offline manifest", () => {
    expect(findManifestWrites(entries)).toEqual([])
  })

  it("an offline write in the real composition root is flagged", () => {
    // `rawExportRuntime.ts` is the ONE export file holding AsyncStorage, and it
    // went unscanned until now. This proves the scan reaches its writes.
    const runtime = "src/lib/rawExportRuntime.ts"
    const mutated = entries.map((entry) =>
      entry.relative === runtime
        ? {
            relative: runtime,
            content: entry.content.replace(
              `set: (key, value) => AsyncStorage.setItem(key, value),`,
              `set: (key, value) => AsyncStorage.setItem("offline." + key, value),`,
            ),
          }
        : entry,
    )
    // Anti-vacuous: the substitution must have landed on real source.
    expect(mutated).not.toEqual(entries)
    expect(findManifestWrites(mutated)).toEqual([
      `${runtime}: offline storage write`,
    ])
  })

  it("positive control: every manifest write symbol is flagged on its own", () => {
    // One fixture per symbol, so dropping any entry from the list fails here.
    const fixtures = MANIFEST_WRITES.map((symbol) => ({
      relative: `${symbol}.ts`,
      content: `await ${symbol}(record)`,
    }))
    expect(findManifestWrites(fixtures)).toEqual(
      MANIFEST_WRITES.map((symbol) => `${symbol}.ts: ${symbol}`).sort(),
    )
  })

  it("positive control: a storage write of an offline key is flagged", () => {
    expect(
      findManifestWrites([
        {
          relative: "a.ts",
          content: `await AsyncStorage.setItem(\`offline.record.\${videoSlug}\`, body)`,
        },
        {
          relative: "b.ts",
          content: `await storage.removeItem(OFFLINE_INDEX_KEY)`,
        },
      ]),
    ).toEqual(["a.ts: offline storage write", "b.ts: offline storage write"])
  })

  it("negative control: the export's own namespaced writes do not flag", () => {
    // The staging note is deliberately outside the `offline.` namespace, which
    // is what keeps offline reconciliation from ever reading it as a record.
    expect(
      findManifestWrites([
        {
          relative: "n1.ts",
          content: `await storage.set(EXPORT_STAGING_NOTES_STORAGE_KEY, body)`,
        },
        {
          relative: "n2.ts",
          content: `await AsyncStorage.setItem("rawexport.staging.notes", body)`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: reading a record type or a record is not a write", () => {
    // R13/R36 keep the READ: the export decides on the offline record it is
    // handed. Only the write side is fenced.
    expect(
      findManifestWrites([
        {
          relative: "r1.ts",
          content: `import type { OfflineDownloadRecord } from "./offlineManifest"`,
        },
        {
          relative: "r2.ts",
          content: `const record = deps.findOfflineRecord(videoSlug)`,
        },
        {
          relative: "r3.ts",
          content: `const parsed = parseOfflineRecord(raw)`,
        },
      ]),
    ).toEqual([])
  })

  it("the strip preserves length, which the key read depends on", () => {
    const sample = [
      `// writeRecord in prose`,
      `/* offlineRecordKey in a block */`,
      `const a = "offline.record"`,
      `const b = \`offline.\${slug}\``,
      `const c = /\\/\\S+/g`,
      `await storage.set(KEY, "\\"quoted\\"")`,
    ].join("\n")
    const stripped = stripCommentsAndStrings(sample)
    expect(stripped.length).toBe(sample.length)
    // The strip must still be doing its job, not returning the input.
    expect(stripped).not.toContain("writeRecord")
    expect(stripped).toContain("slug")
  })

  it("negative control: a symbol named only in prose does not flag", () => {
    // exportSession.ts names AsyncStorage in its head comment, so a scan that
    // skipped the comment strip would flag a module that imports nothing.
    expect(
      findManifestWrites([
        {
          relative: "p.ts",
          content: `// this module never calls writeRecord or offlineRecordKey\nconst x = 1`,
        },
      ]),
    ).toEqual([])
  })
})
