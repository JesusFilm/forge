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
// assigned from `telemetryErrorMessage(...)`, or from a value this scan can see
// was produced by it. Anything else — `String(error)`, `error.message`, a bare
// `errorMessageOf(...)` — is a leak.

const APP_ROOT = path.resolve(__dirname, "../../..")

const EXPORT_MODULES = [
  "src/lib/rawExport.ts",
  "src/lib/rawExportAdapter.ts",
  "src/lib/rawExportRun.ts",
  "src/lib/exportSweep.ts",
  "src/lib/transferPort.ts",
  "src/lib/exportSession.ts",
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

/**
 * A local name is redaction-safe when every assignment to it in this file came
 * from the safe helper. That is what lets a module build the value once and
 * reference it by name at the emit site.
 */
function safeLocalNames(source) {
  const names = new Set()
  const re = /\b([A-Za-z_$][\w$]*)\s*[:=]\s*telemetryErrorMessage\(/g
  let match
  while ((match = re.exec(source)) != null) names.add(match[1])
  return names
}

function readIfPresent(relative) {
  const full = path.join(APP_ROOT, relative)
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null
}

/** Pure detector over [{ relative, content }] so the controls prove branches. */
function findRawErrorMessages(entries) {
  const hits = []
  for (const entry of entries) {
    const safeNames = safeLocalNames(entry.content)
    for (const expression of errorMessageAssignments(entry.content)) {
      if (expression.includes(`${SAFE}(`)) continue
      // `failure.errorMessage` / `x.errorMessage` — safe only when the field was
      // itself built from the helper somewhere in this file.
      const field = /^[\w$]+\.([\w$]+)$/.exec(expression)
      if (field && safeNames.has(field[1])) continue
      if (safeNames.has(expression)) continue
      hits.push(`${entry.relative}: ${expression}`)
    }
  }
  return hits.sort()
}

describe("export telemetry never carries a raw error message", () => {
  it("every export module redacts before it emits", () => {
    const entries = EXPORT_MODULES.map((relative) => ({
      relative,
      content: readIfPresent(relative),
    })).filter((entry) => entry.content != null)

    // A broken path resolution or a wholesale rename must not pass vacuously.
    expect(entries.length).toBeGreaterThanOrEqual(6)
    expect(findRawErrorMessages(entries)).toEqual([])
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
})
