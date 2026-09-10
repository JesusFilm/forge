// Plain JS (like the other guards here): the RN tsconfig has no Node types,
// and this guard scans source files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: a caught transfer error carries the SIGNED media URL, and a caught
// filesystem error carries the staged path. `datadogLog` forwards its context
// object to Datadog unchanged, so redaction has to happen at the call site —
// which is exactly the kind of step that gets omitted silently. The offline
// path has always routed through `sanitizeNativeErrorMessage`; the export path
// shipped raw for five call sites before this guard existed.
//
// The rule: inside an export module, an `error_message` attribute may only be
// assigned from `telemetryErrorMessage(...)`, from an explicit blank, or from a
// binding this scan can see was built that way. Anything else — `String(error)`,
// `error.message`, a bare `errorMessageOf(...)` — is a leak.
//
// The allowance is per BINDING, never per field NAME. A name-scoped allowance
// lets one safe assignment whitelist every other use of that name in the file,
// and `rawExport.ts` holds such an assignment already — so a raw
// `failure.errorMessage` beside it would have emitted a signed URL with this
// guard green.

const APP_ROOT = path.resolve(__dirname, "../../..")

// The export path, in full. Membership is asserted below, so a rename cannot
// drop a module from the scan and leave the rule looking enforced.
const EXPORT_MODULES = [
  "src/lib/rawExport.ts",
  "src/lib/rawExportAdapter.ts",
  "src/lib/rawExportRun.ts",
  "src/lib/exportSweep.ts",
  "src/lib/transferPort.ts",
  "src/lib/exportSession.ts",
  "src/lib/exportReport.ts",
  "src/lib/rawExportConstants.ts",
  "src/lib/rawExportRuntime.ts",
  "src/components/ExportReportHost.tsx",
]

const SAFE = "telemetryErrorMessage"

/** Assignments to the telemetry attribute, with the expression they take. */
function errorMessageAssignments(source) {
  const found = []
  const re = /\berror_message\s*:\s*([^,\n}]+)/g
  let match
  while ((match = re.exec(source)) != null) found.push(match[1].trim())
  return found
}

/** Right sides that cannot carry raw text: the helper, or an explicit blank. */
function isRedactedExpression(expression) {
  const value = expression.trim()
  return value.includes(`${SAFE}(`) || value === "null" || value === "undefined"
}

// Source between the `{` at `open` and its match; null when unbalanced.
// LIMIT: a brace inside a string literal desynchronizes this.
function braceBody(source, open) {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++
    else if (source[i] === "}" && --depth === 0)
      return source.slice(open + 1, i)
  }
  return null
}

// `name = <value>` / `name: Type = <value>`. The type annotation may not span a
// line or a brace, so a type MEMBER (`failure: ExportFailure }`) cannot read as
// a binding, and `=(?![=>])` keeps `===` and `=>` out.
function bindingPattern(name, tail) {
  return new RegExp(`\\b${name}\\s*(?::[^=;{}\\n]*)?=(?![=>])\\s*${tail}`, "g")
}

/**
 * Is `object.field` redacted? Only when EVERY object-literal binding of
 * `object` in this file assigns `field` safely, and there is at least one.
 */
function fieldIsRedacted(source, object, field) {
  const binding = bindingPattern(object, "\\{")
  const entry = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`)
  const values = []
  // The match itself is unused: `lastIndex` is the index of the binding's `{`.
  while (binding.exec(source) != null) {
    const body = braceBody(source, binding.lastIndex - 1)
    if (body == null) continue
    const assigned = entry.exec(body)
    if (assigned != null) values.push(assigned[1])
  }
  return values.length > 0 && values.every(isRedactedExpression)
}

/** The same rule for a plain local: every binding of it must be redacted. */
function localIsRedacted(source, name) {
  const binding = bindingPattern(name, "([^\\n;]+)")
  const values = []
  let match
  while ((match = binding.exec(source)) != null) values.push(match[1])
  return values.length > 0 && values.every(isRedactedExpression)
}

function readIfPresent(relative) {
  const full = path.join(APP_ROOT, relative)
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null
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

/** Pure detector over [{ relative, content }] so the controls prove branches. */
function findRawErrorMessages(entries) {
  const hits = []
  for (const entry of entries) {
    for (const expression of errorMessageAssignments(entry.content)) {
      if (isRedactedExpression(expression)) continue
      const field = /^([\w$]+)\.([\w$]+)$/.exec(expression)
      if (field != null && fieldIsRedacted(entry.content, field[1], field[2])) {
        continue
      }
      if (
        /^[\w$]+$/.test(expression) &&
        localIsRedacted(entry.content, expression)
      ) {
        continue
      }
      hits.push(`${entry.relative}: ${expression}`)
    }
  }
  return hits.sort()
}

describe("export telemetry never carries a raw error message", () => {
  const entries = collectEntries(readIfPresent)

  it("the scan reads every listed export module", () => {
    // Membership, not a count. A count-only floor let two modules disappear —
    // a rename during a refactor is exactly how that happens.
    expect(entries.map((entry) => entry.relative)).toEqual(EXPORT_MODULES)
    for (const entry of entries) {
      expect(entry.content).toContain("export")
    }
  })

  it("a starved reader is caught, not tolerated", () => {
    const starved = collectEntries(() => null)
    expect(starved).toEqual([])
    expect(starved.map((entry) => entry.relative)).not.toEqual(EXPORT_MODULES)
  })

  it("every export module redacts before it emits", () => {
    expect(findRawErrorMessages(entries)).toEqual([])
  })

  it("a raw sibling binding in the real rawExport.ts is flagged", () => {
    // Falsification, kept: the exact defect the name-scoped allowance hid —
    // one of three real `failure` bindings turned raw. Both emit sites flag.
    const mutated = entries.map((entry) =>
      entry.relative === "src/lib/rawExport.ts"
        ? {
            relative: entry.relative,
            content: entry.content.replace(
              `errorMessage: telemetryErrorMessage(error),`,
              `errorMessage: String(error),`,
            ),
          }
        : entry,
    )
    // Anti-vacuous: the substitution must have landed on real source.
    expect(mutated).not.toEqual(entries)
    expect(findRawErrorMessages(mutated)).toEqual([
      "src/lib/rawExport.ts: failure.errorMessage",
      "src/lib/rawExport.ts: failure.errorMessage",
    ])
  })

  it("positive control: each unredacted shape is flagged", () => {
    expect(
      findRawErrorMessages([
        {
          relative: "a.ts",
          content: `warn("e", { error_message: String(e) })`,
        },
        {
          relative: "b.ts",
          content: `warn("e", { error_message: e.message })`,
        },
        {
          relative: "c.ts",
          content: `warn("e", { error_message: errorMessageOf(e) })`,
        },
      ]),
    ).toEqual(["a.ts: String(e)", "b.ts: e.message", "c.ts: errorMessageOf(e)"])
  })

  it("negative control: the helper, and a field built from it, both pass", () => {
    expect(
      findRawErrorMessages([
        {
          relative: "d.ts",
          content: `warn("e", { error_message: telemetryErrorMessage(e) })`,
        },
        {
          relative: "e.ts",
          content: `const failure = { errorMessage: telemetryErrorMessage(e) }\nwarn("e", { error_message: failure.errorMessage })`,
        },
        {
          relative: "e2.ts",
          content: `const redacted = telemetryErrorMessage(e)\nwarn("e", { error_message: redacted })`,
        },
      ]),
    ).toEqual([])
  })

  it("negative control: rawExport's real three-binding shape passes", () => {
    // The production shape, reduced: two helper bindings and one explicit
    // blank, all to `failure`. A rule that treated `null` as raw would flag
    // the two legitimate emit sites in `rawExport.ts`.
    expect(
      findRawErrorMessages([
        {
          relative: "real.ts",
          content:
            `export type ExportFailure = { cause: string; errorMessage: string | null }\n` +
            `const failure: ExportFailure = { cause: "permissionError", errorMessage: telemetryErrorMessage(error) }\n` +
            `warn("e", { error_message: failure.errorMessage })\n` +
            `const failure2: ExportFailure = { cause: report.interruption.kind, errorMessage: null }\n` +
            `warn("e", { error_message: failure2.errorMessage })`,
        },
      ]),
    ).toEqual([])
  })

  it("positive control: a field NOT built from the helper is still flagged", () => {
    // The hole the field allowance could otherwise open.
    expect(
      findRawErrorMessages([
        {
          relative: "f.ts",
          content: `const failure = { errorMessage: String(e) }\nwarn("e", { error_message: failure.errorMessage })`,
        },
      ]),
    ).toEqual(["f.ts: failure.errorMessage"])
  })

  it("positive control: one safe assignment does not whitelist the name", () => {
    // The allowance is per BINDING, never per field name. A file that builds
    // the field safely once and rawly once must flag the raw one.
    expect(
      findRawErrorMessages([
        {
          relative: "g.ts",
          content:
            `const good = { errorMessage: telemetryErrorMessage(e) }\n` +
            `const bad = { errorMessage: String(e) }\n` +
            `warn("e", { error_message: bad.errorMessage })`,
        },
        {
          relative: "h.ts",
          content:
            `let failure = { errorMessage: telemetryErrorMessage(e) }\n` +
            `failure = { errorMessage: String(e) }\n` +
            `warn("e", { error_message: failure.errorMessage })`,
        },
        {
          relative: "i.ts",
          content:
            `let redacted = telemetryErrorMessage(e)\n` +
            `redacted = String(e)\n` +
            `warn("e", { error_message: redacted })`,
        },
      ]),
    ).toEqual([
      "g.ts: bad.errorMessage",
      "h.ts: failure.errorMessage",
      "i.ts: redacted",
    ])
  })

  it("positive control: a field this scan never saw built is flagged", () => {
    // A value handed in from outside the file cannot be proved redacted, and
    // an unprovable value is a leak until someone proves otherwise.
    expect(
      findRawErrorMessages([
        {
          relative: "j.ts",
          content: `const emit = (report) => warn("e", { error_message: report.errorMessage })`,
        },
      ]),
    ).toEqual(["j.ts: report.errorMessage"])
  })
})
