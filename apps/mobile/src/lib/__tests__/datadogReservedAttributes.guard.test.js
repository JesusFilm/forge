// Plain JS (like watchSearchTelemetry.guard.test.js): the RN tsconfig has no
// Node types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: Datadog claims these log-attribute names for its own pipeline. A
// custom attribute using one is DROPPED ON INGEST with no error, no warning,
// and no visible change to the log — only the facet goes missing, so emit-side
// tests keep passing. See
// docs/solutions/conventions/datadog-reserved-log-attribute-name-shadowing.md
const RESERVED = ["source", "host", "service", "status", "message", "trace_id"]

const CALL = /\b(?:datadogLog|DdLogs)\.(?:info|warn|error|debug)\s*\(/g

// Returns the source text between `open` (index of a bracket) and its match,
// skipping strings, template literals, and comments. null if unbalanced.
function balanced(src, open) {
  const PAIRS = { "(": ")", "{": "}", "[": "]" }
  const stack = [PAIRS[src[open]]]
  let i = open + 1
  while (i < src.length) {
    const c = src[i]
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++
        i++
      }
      i++
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2)
      if (i < 0) return null
      i += 2
      continue
    }
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

// Top-level keys of an object literal. Two things make this more than a regex:
// depth (a reserved name nested under a namespaced parent is not a top-level
// attribute, so it is not dropped) and key-vs-value position (`{ http_status:
// r.status }` must not flag on the VALUE's `.status`).
function topLevelKeys(objBody) {
  const keys = []
  let depth = 0
  let atKey = true
  let i = 0
  while (i < objBody.length) {
    const c = objBody[i]
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      const start = i
      i++
      while (i < objBody.length && objBody[i] !== quote) {
        if (objBody[i] === "\\") i++
        i++
      }
      const literal = objBody.slice(start + 1, i)
      i++
      if (depth === 0 && atKey && /^\s*:/.test(objBody.slice(i))) {
        keys.push(literal)
        atKey = false
      }
      continue
    }
    if (c === "/" && objBody[i + 1] === "/") {
      while (i < objBody.length && objBody[i] !== "\n") i++
      continue
    }
    if (c === "/" && objBody[i + 1] === "*") {
      i = objBody.indexOf("*/", i + 2)
      if (i < 0) break
      i += 2
      continue
    }
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
      atKey = true
      i++
      continue
    }
    // A spread contributes no statically-known key; skip to its value.
    if (depth === 0 && atKey && objBody.startsWith("...", i)) {
      atKey = false
      i += 3
      continue
    }
    if (depth === 0 && atKey && /[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z0-9_$]+/.exec(objBody.slice(i))[0]
      const after = objBody.slice(i + word.length)
      // `key:` is longhand; `key,` / `key}` / `key<end>` is ES6 shorthand —
      // the form that hid two live collisions from the original audit.
      if (/^\s*:/.test(after) || /^\s*(,|$)/.test(after)) keys.push(word)
      atKey = false
      i += word.length
      continue
    }
    i++
  }
  return keys
}

// Pure detector over [{ relative, content }] so controls can prove each branch.
function findReservedAttributes(entries) {
  const hits = []
  for (const entry of entries) {
    CALL.lastIndex = 0
    while (CALL.exec(entry.content) != null) {
      const args = balanced(entry.content, CALL.lastIndex - 1)
      if (args == null) continue
      const objStart = args.indexOf("{")
      if (objStart < 0) continue
      const body = balanced(args, objStart)
      if (body == null) continue
      for (const key of topLevelKeys(body)) {
        if (RESERVED.includes(key)) hits.push(`${entry.relative}: ${key}`)
      }
    }
  }
  return hits.sort()
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

describe("no Datadog log attribute shadows a reserved field", () => {
  it("no reserved attribute names in src/ or app/", () => {
    const root = path.resolve(__dirname, "../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    // A broken root resolution or empty scan must not vacuously pass.
    expect(files.length).toBeGreaterThan(50)
    const entries = files.map((file) => ({
      relative: path.relative(root, file),
      content: fs.readFileSync(file, "utf8"),
    }))
    expect(findReservedAttributes(entries)).toEqual([])
  })

  it("positive control: every reserved name is flagged on its own", () => {
    // One fixture per name, so dropping any entry from RESERVED fails here.
    const entries = RESERVED.map((name) => ({
      relative: `${name}.ts`,
      content: `datadogLog.info("evt", { ${name}: value })`,
    }))
    expect(findReservedAttributes(entries)).toEqual(
      RESERVED.map((name) => `${name}.ts: ${name}`).sort(),
    )
  })

  it("positive control: ES6 shorthand is flagged", () => {
    // The form that hid HomeHeroPager's two live collisions: a scan keyed on
    // `message\s*:` matches neither of these.
    expect(
      findReservedAttributes([
        { relative: "a.tsx", content: `datadogLog.warn("e", { message })` },
        {
          relative: "b.tsx",
          content: `datadogLog.warn("e", { surface: "hero", message })`,
        },
      ]),
    ).toEqual(["a.tsx: message", "b.tsx: message"])
  })

  it("positive control: flagged across a multi-line call", () => {
    expect(
      findReservedAttributes([
        {
          relative: "c.ts",
          content: `datadogLog.info("home_feed_ready", {\n  source: "network",\n  outcome: "failed",\n})`,
        },
      ]),
    ).toEqual(["c.ts: source"])
  })

  it("negative control: namespaced, renamed, and nested keys do not flag", () => {
    expect(
      findReservedAttributes([
        // Namespaced — the repo's preferred shape, collision-proof.
        {
          relative: "n1.ts",
          content: `datadogLog.info("watch_search", { "watch_search.status": s, "watch_search.source": x })`,
        },
        // The renames this guard exists to hold in place.
        {
          relative: "n2.ts",
          content: `datadogLog.info("home_feed_ready", { feed_source: "network", outcome: "ok" })`,
        },
        {
          relative: "n3.ts",
          content: `datadogLog.warn("sidecar.download_bad_status", { http_status: r.status })`,
        },
        {
          relative: "n4.tsx",
          content: `datadogLog.warn("video.playback_error", { error_message: errorMessage })`,
        },
        // Nested under a non-reserved parent: not a top-level attribute.
        {
          relative: "n5.ts",
          content: `datadogLog.info("e", { detail: { status: 404, message: m } })`,
        },
        // The wrapper itself forwards positionals — no object literal at all.
        {
          relative: "n6.ts",
          content: `info: (message, context) => safeDatadogCall(() => DdLogs.info(message, context))`,
        },
        // A reserved word as a VALUE, not a key.
        {
          relative: "n7.ts",
          content: `datadogLog.info("e", { phase: status, label: message })`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: a spread of a checked summary does not flag", () => {
    // video.qoe spreads VideoQoeSummary; the spread is opaque here, which is
    // why the summary type's own field names are pinned by videoQoe tests.
    expect(
      findReservedAttributes([
        {
          relative: "q.ts",
          content: `datadogLog.info("video.qoe", { ...summary, playback_source: s })`,
        },
      ]),
    ).toEqual([])
  })
})
