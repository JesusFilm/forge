// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// KTD2: the engine keys every transfer by a bare slug, and the offline path
// already owns that key space. An export handing the engine a bare slug shares
// one id with a live download — cancel, completion and progress all cross over.
const NAMESPACE_BUILDER = "buildExportTaskId"

// A slug reaching an id position is the defect. `target` is here because the
// session store names the same value that way.
const SLUG_TOKEN = /\b(?:videoSlug|seriesSlug|slug|target)\b/

// Every function whose argument IS a transfer id. `requestCancel` is
// deliberately absent: it takes a TARGET, which is a slug by contract.
const ID_SINKS = [
  "stopExportTransfer",
  "signalBackgroundCompletion",
  "notifyBackgroundComplete",
  "isExportTaskId",
  "exportTargetFromTaskId",
]

// A transfer spec is recognised by its siblings, so an unrelated `id:` key
// elsewhere in an export module cannot trip this rule.
const SPEC_SIBLINGS = ["url", "destination", "allowCellular"]

const EXPORT_MODULES = [
  "src/lib/rawExport.ts",
  "src/lib/rawExportAdapter.ts",
  "src/lib/transferPort.ts",
  "src/lib/exportSession.ts",
  "src/lib/rawExportRun.ts",
  "src/lib/exportSweep.ts",
  "src/lib/rawExportConstants.ts",
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

// Source between `open` (index of a bracket) and its match. null if unbalanced.
function balanced(src, open) {
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
      if (stack.length === 0) return src.slice(open + 1, i)
      i++
      continue
    }
    i++
  }
  return null
}

/**
 * Top-level `key: value` pairs of an object literal, with the value's source
 * text. Depth and key-vs-value position both matter: a nested `id` is not the
 * spec's id, and `{ url: spec.id }` must not read as an id assignment.
 */
function topLevelEntries(objBody) {
  const entries = []
  let depth = 0
  let atKey = true
  let pending = null
  let i = 0
  const close = (end) => {
    if (pending == null) return
    entries.push({ key: pending.key, value: objBody.slice(pending.start, end) })
    pending = null
  }
  while (i < objBody.length) {
    const c = objBody[i]
    if (c === "{" || c === "[" || c === "(") {
      depth++
      i++
      continue
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--
      i++
      continue
    }
    if (depth === 0 && c === ",") {
      close(i)
      atKey = true
      i++
      continue
    }
    if (depth === 0 && atKey && objBody.startsWith("...", i)) {
      atKey = false
      i += 3
      continue
    }
    if (depth === 0 && atKey && /[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z0-9_$]+/.exec(objBody.slice(i))[0]
      const after = objBody.slice(i + word.length)
      const colon = /^\s*:/.exec(after)
      atKey = false
      if (colon != null) {
        pending = { key: word, start: i + word.length + colon[0].length }
        i += word.length + colon[0].length
        continue
      }
      // ES6 shorthand: the value IS the key name.
      if (/^\s*(,|$)/.test(after)) entries.push({ key: word, value: word })
      i += word.length
      continue
    }
    i++
  }
  close(objBody.length)
  return entries
}

/** A slug reaching an id position, unless the namespace builder wraps it. */
function isBareSlug(expression) {
  return SLUG_TOKEN.test(expression) && !expression.includes(NAMESPACE_BUILDER)
}

/** Pure detector over [{ relative, content }] so controls prove each branch. */
function findBareSlugIds(entries) {
  const hits = []
  for (const entry of entries) {
    const code = stripCommentsAndStrings(entry.content)
    for (const sink of ID_SINKS.concat("stop")) {
      const call =
        sink === "stop" ? /\.stop\s*\(/g : new RegExp(`\\b${sink}\\s*\\(`, "g")
      call.lastIndex = 0
      while (call.exec(code) != null) {
        const args = balanced(code, call.lastIndex - 1)
        if (args == null) continue
        if (isBareSlug(args)) hits.push(`${entry.relative}: ${sink}`)
      }
    }
    for (let i = 0; i < code.length; i++) {
      if (code[i] !== "{") continue
      const body = balanced(code, i)
      if (body == null) continue
      const fields = topLevelEntries(body)
      const keys = fields.map((field) => field.key)
      if (!keys.includes("id")) continue
      if (!SPEC_SIBLINGS.some((sibling) => keys.includes(sibling))) continue
      const id = fields.find((field) => field.key === "id")
      if (isBareSlug(id.value)) hits.push(`${entry.relative}: spec.id`)
    }
  }
  return Array.from(new Set(hits)).sort()
}

const APP_ROOT = path.resolve(__dirname, "../../..")

/** Tolerates a module that does not exist yet; two are still being written. */
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

// Six of the eight modules exist today; the rest only add. A lower floor would
// let a broken path resolution pass by scanning nothing.
const MODULE_FLOOR = 6

describe("every export transfer id carries the export namespace", () => {
  const entries = collectEntries(readSource)

  it("the scan reads real export modules", () => {
    expect(entries.length).toBeGreaterThanOrEqual(MODULE_FLOOR)
    for (const entry of entries) {
      expect(entry.content.length).toBeGreaterThan(200)
      expect(entry.content).toContain("export")
    }
  })

  it("the floor fails when the scan matches nothing", () => {
    const starved = collectEntries(() => null)
    expect(starved).toEqual([])
    expect(starved.length).toBeLessThan(MODULE_FLOOR)
  })

  it("no export module passes a bare slug as a transfer id", () => {
    expect(findBareSlugIds(entries)).toEqual([])
  })

  it("positive control: a bare slug at a sink and in a spec is flagged", () => {
    expect(
      findBareSlugIds([
        {
          relative: "sink.ts",
          content: `void deps.port.stopExportTransfer(videoSlug)`,
        },
        {
          relative: "spec.ts",
          content: `const spec = { id: input.videoSlug, url: r.url, destination: staged }`,
        },
        {
          relative: "stop.ts",
          content: `await deps.transfer.stop(note.target)`,
        },
      ]),
    ).toEqual([
      "sink.ts: stopExportTransfer",
      "spec.ts: spec.id",
      "stop.ts: stop",
    ])
  })

  it("negative control: the namespaced forms do not flag", () => {
    expect(
      findBareSlugIds([
        {
          relative: "n1.ts",
          content: `void deps.port.stopExportTransfer(buildExportTaskId(videoSlug))`,
        },
        // An id already in a variable is namespaced upstream.
        { relative: "n2.ts", content: `deps.port.stopExportTransfer(taskId)` },
        {
          relative: "n3.ts",
          content: `stop: (id) => deps.port.stopExportTransfer(id)`,
        },
        {
          relative: "n4.ts",
          content: `return { id: buildExportTaskId(input.videoSlug), url: u, destination: d }`,
        },
        // The target-keyed session API is not an id sink.
        { relative: "n5.ts", content: `store.requestCancel(videoSlug)` },
        // A slug named only in prose.
        {
          relative: "n6.ts",
          content: `// never hand videoSlug to stopExportTransfer(videoSlug)\nconst x = 1`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: an unrelated id key is not a transfer spec", () => {
    // Without the sibling check this rule would police every `id:` in the
    // export path, and a report or record id is not a transfer id.
    expect(
      findBareSlugIds([
        {
          relative: "r.ts",
          content: `report({ id: videoSlug, outcome: "saved" })`,
        },
        {
          relative: "t.ts",
          content: `type Spec = { id: string; url: string }`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: a nested id does not read as the spec's id", () => {
    expect(
      findBareSlugIds([
        {
          relative: "d.ts",
          content: `send({ url: u, destination: d, detail: { id: videoSlug } })`,
        },
      ]),
    ).toEqual([])
  })
})
