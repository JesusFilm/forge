"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// summary.json is the one source of every report output (KTD16). buildSummary
// checks it against the committed schema; the renderers read only that file.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const { EXIT, validateAgainstSchema } = require("../contract")

const SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "schema", "summary.schema.json"),
    "utf8",
  ),
)
const SCHEMA_VERSION = 1
const SUMMARY_FILE = "summary.json"
const REPORT_FILE = "report.html"
const MARKDOWN_FILE = "summary.md"

// R29 names four groups; "not run" also fails the run, so it comes before the
// passes.
const LABEL_ORDER = Object.freeze(["new", "flaky", "known", "not_run", "pass"])
const LABEL_TITLES = Object.freeze({
  new: "New failures",
  flaky: "Flaky journeys",
  known: "Known failures",
  not_run: "Not run",
  pass: "Passes",
})
const LABEL_NAMES = Object.freeze({
  new: "New failure",
  flaky: "Flaky",
  known: "Known failure",
  not_run: "Not run",
  pass: "Pass",
})

const STOP_REASON_TEXT = Object.freeze({
  completed: "The run completed all of its phases.",
  aborted: "The person stopped the run.",
  timeout: "A journey, a phase, or the whole run went past its time limit.",
  upstream_unavailable:
    "Production admin did not answer 5 forwarded requests in a row.",
  host_overload:
    "The Mac did not have enough free memory, or its load was too high, to continue.",
  build_failed: "A test build failed.",
  build_check_failed: "A test build did not pass the build check.",
  probe_failed: "The settings probe failed, so no other journey ran.",
  runner_error: "An error in the runner stopped the run.",
  runner_killed:
    "The runner process stopped before its end steps. The recover step wrote this report.",
})

const CLASS_TEXT = Object.freeze({
  assertion_failed: "A check in the journey was false.",
  selector_not_found: "The journey did not find a control or a screen.",
  app_crashed: "The app crashed.",
  app_unresponsive: "The app stopped responding.",
  device_unresponsive: "The device stopped answering the device tools.",
  driver_failed: "Maestro failed.",
  rate_limited: "Production admin refused a request because of its rate limit.",
  request_blocked: "The read-only server blocked a request from the app.",
  missing_search_answer: "A search had no saved answer.",
  memory_pressure_kill: "The system stopped the app because memory was low.",
})

// The Datadog client token shape that the build check looks for (KTD5). A
// finding names the setting, so this shape never belongs in a report.
const DATADOG_CLIENT_TOKEN = /pub[0-9a-f]{32}/gi
const HOME_FOLDER = /\/Users\/[^/\s"'<>]+/g
const REDACTED = "[redacted]"

class SummaryError extends Error {
  constructor(errors) {
    super(`the release check summary is not valid: ${errors.join("; ")}`)
    this.name = "SummaryError"
    this.errors = errors
  }
}

function scrubText(text) {
  return text.replace(HOME_FOLDER, "~").replace(DATADOG_CLIENT_TOKEN, REDACTED)
}

/** A copy of `value` with no home folder path and no Datadog client token. */
function scrub(value) {
  if (typeof value === "string") return scrubText(value)
  if (Array.isArray(value)) return value.map(scrub)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [scrubText(key), scrub(item)]),
    )
  }
  return value
}

function assertValid(summary) {
  const errors = validateAgainstSchema(SCHEMA, summary)
  if (errors.length > 0) throw new SummaryError(errors)
}

function isFirstTryPass(attempt) {
  return (
    attempt?.attempt === 1 &&
    attempt.status === "passed" &&
    attempt.label === "pass"
  )
}

// R26: "pass" only when the scope is not empty, every attempt is a first-try
// pass, the screen list has no gap, every check passed, and the run completed.
function decideResult(input) {
  const attempts = Array.isArray(input?.attempts) ? input.attempts : []
  const checks = input?.checks ?? {}
  const gaps = checks.screens?.gaps
  const passed =
    input?.outcome?.stopReason === "completed" &&
    attempts.length > 0 &&
    attempts.every(isFirstTryPass) &&
    Array.isArray(gaps) &&
    gaps.length === 0 &&
    checks.build?.passed === true &&
    checks.log?.passed === true &&
    checks.settingsProbe?.passed === true
  return passed ? "pass" : "fail"
}

function compareText(a, b) {
  const left = String(a)
  const right = String(b)
  if (left < right) return -1
  return left > right ? 1 : 0
}

function labelRank(label) {
  const rank = LABEL_ORDER.indexOf(label)
  return rank < 0 ? LABEL_ORDER.length : rank
}

// One entry for each journey on each device. Its label is the label of its
// last attempt, because a retry decides "flaky" or "new" (R27).
function journeyResults(attempts) {
  const groups = new Map()
  for (const attempt of attempts) {
    const key = JSON.stringify([attempt?.journey, attempt?.deviceId])
    groups.set(key, [...(groups.get(key) ?? []), attempt])
  }
  return [...groups.values()]
    .map((group) => {
      const ordered = [...group].sort(
        (a, b) => (a?.attempt ?? 0) - (b?.attempt ?? 0),
      )
      const last = ordered[ordered.length - 1]
      return {
        journey: last?.journey,
        deviceId: last?.deviceId,
        label: last?.label,
        attempts: ordered,
      }
    })
    .sort(
      (a, b) =>
        labelRank(a.label) - labelRank(b.label) ||
        compareText(a.journey, b.journey) ||
        compareText(a.deviceId, b.deviceId),
    )
}

function countLabels(journeys) {
  const counts = Object.fromEntries(LABEL_ORDER.map((label) => [label, 0]))
  for (const entry of journeys) {
    if (Object.hasOwn(counts, entry.label)) counts[entry.label] += 1
  }
  return counts
}

function failureCausedBy(refusal, attempts) {
  const failed = attempts.find(
    (attempt) =>
      attempt?.status === "failed" &&
      attempt.journey === refusal?.journey &&
      attempt.deviceId === refusal?.deviceId &&
      attempt.attempt === refusal?.attempt,
  )
  return failed
    ? {
        label: failed.label,
        class: failed.class,
        failedStep: failed.failedStep,
      }
    : null
}

function withCausedFailures(refusals, attempts) {
  if (refusals === undefined) return []
  if (!Array.isArray(refusals)) return refusals
  return refusals.map((refusal) => ({
    ...refusal,
    causedFailure: failureCausedBy(refusal, attempts),
  }))
}

// Builds and checks summary.json from what the run collected. It throws a
// SummaryError when the result does not match the schema.
function buildSummary(input) {
  if (input?.attempts !== undefined && !Array.isArray(input.attempts)) {
    throw new SummaryError(["the attempts input must be a list"])
  }
  const identity = input?.identity ?? {}
  const outcome = input?.outcome ?? {}
  const attempts = input?.attempts ?? []
  const checks = input?.checks ?? {}
  const server = input?.server ?? {}
  const result = decideResult(input)
  const exitCode = result === "pass" ? EXIT.passed : EXIT.failed
  if (outcome.exitCode !== undefined && outcome.exitCode !== exitCode) {
    throw new SummaryError([
      `outcome.exitCode is ${outcome.exitCode}, but result ${result} needs ${exitCode}`,
    ])
  }
  const journeys = journeyResults(attempts)
  const summary = scrub({
    schemaVersion: SCHEMA_VERSION,
    runId: identity.runId,
    scope: identity.scope,
    result,
    exitCode,
    stopReason: outcome.stopReason,
    completedPhases: outcome.completedPhases ?? [],
    commit: identity.commit,
    startedAt: identity.startedAt,
    endedAt: identity.endedAt,
    inputDigests: identity.inputDigests ?? {},
    listDigests: identity.listDigests ?? {},
    toolVersions: identity.toolVersions ?? {},
    devicePins: identity.devicePins ?? {},
    macTimeZone: identity.macTimeZone,
    counts: countLabels(journeys),
    journeys,
    checks: {
      build: checks.build ?? null,
      log: checks.log ?? null,
      screens: checks.screens ?? null,
      settingsProbe: checks.settingsProbe ?? null,
    },
    server: {
      routes: server.routes ?? {},
      rateLimitRefusals: withCausedFailures(server.rateLimitRefusals, attempts),
    },
    notTested: input?.notTested ?? [],
    staleKnownBugs: input?.staleKnownBugs ?? [],
    restarts: input?.restarts ?? [],
    speed:
      input?.speed === undefined || input.speed === null
        ? null
        : { ...input.speed, informationOnly: true },
    proposedActions: input?.proposedActions ?? [],
  })
  assertValid(summary)
  return summary
}

/** Writes `file` through a temporary file in the same folder and a rename. */
function writeFileAtomic(file, text) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  )
  try {
    const fd = fs.openSync(temp, "wx")
    try {
      fs.writeFileSync(fd, text)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/** Writes `<runDir>/summary.json` with an atomic rename (KTD16). */
function writeSummary(runDir, summary) {
  const clean = scrub(summary)
  assertValid(clean)
  const file = path.join(runDir, SUMMARY_FILE)
  writeFileAtomic(file, `${JSON.stringify(clean, null, 2)}\n`)
  return file
}

function readSummary(runDir) {
  const summary = JSON.parse(
    fs.readFileSync(path.join(runDir, SUMMARY_FILE), "utf8"),
  )
  assertValid(summary)
  return summary
}

/** Reads only `<runDir>/summary.json` and writes report.html and summary.md. */
function renderReport(runDir) {
  const summary = readSummary(runDir)
  // Required here, because both renderers require this module.
  const { renderHtml } = require("./renderHtml")
  const { renderMarkdown } = require("./renderMarkdown")
  writeFileAtomic(path.join(runDir, REPORT_FILE), renderHtml(summary))
  writeFileAtomic(path.join(runDir, MARKDOWN_FILE), renderMarkdown(summary))
  return { summary: SUMMARY_FILE, report: REPORT_FILE, markdown: MARKDOWN_FILE }
}

// ── Words that both renderers share ─────────────────────────────────

/** The headline and the lines under it. A partial run is never a release result. */
function headlineOf(summary) {
  if (summary.scope === "partial") {
    return {
      title: `Partial check: ${summary.result}. This is not a release result.`,
      lines: [
        "This run checked only part of the release scope, so it is not a release result.",
        "This report gives no release decision.",
      ],
    }
  }
  return {
    title: `Release check: ${summary.result}`,
    lines: [
      "This report gives no release decision. The mobile owner makes that decision.",
    ],
  }
}

function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function durationText(summary) {
  return formatMs(Date.parse(summary.endedAt) - Date.parse(summary.startedAt))
}

function checkStatusText(check) {
  if (check === null) return "did not run"
  return check.passed ? "passed" : "failed"
}

const ATTEMPT_STATUS_TEXT = Object.freeze({
  passed: "passed",
  failed: "failed",
  not_run: "did not run",
})

function named(value) {
  return value === null || value === undefined ? "not named" : String(value)
}

function listText(items) {
  return Array.isArray(items) && items.length > 0 ? items.join(", ") : "none"
}

function actionText(action) {
  switch (action.type) {
    case "write_journey":
      return `Write a journey for screen ${named(action.screen)} on ${named(action.platform)}.`
    case "record_search_answer": {
      const search = action.search
      if (!search) return "Record a saved search answer."
      return `Record a saved search answer for "${search.query}" (limit ${search.limit}, offset ${search.offset}, language ${named(search.language)}).`
    }
    case "remove_known_bug":
      return `Remove the Known-Bug entry for ${named(action.journey)}, step "${named(action.step)}", ticket ${named(action.ticket)}.`
    case "add_known_bug":
      return `Add a Known-Bug entry for ${named(action.journey)} on ${listText(action.devices)}: step "${named(action.step)}", check ${named(action.check)}. File a ticket for it first.`
    default:
      return named(action.type)
  }
}

function causedFailureText(caused) {
  if (caused === null) return "No failure"
  const step = caused.failedStep === null ? "" : ` at "${caused.failedStep}"`
  return `${LABEL_NAMES[caused.label]}: ${named(caused.class)}${step}`
}

// encodeURIComponent keeps ( ) ! * ' ~, and a Markdown link breaks on ")".
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** A link to a run-folder file that works from any copy of the folder. */
function relativeHref(relativePath) {
  return relativePath.split("/").map(encodeSegment).join("/")
}

module.exports = {
  ATTEMPT_STATUS_TEXT,
  CLASS_TEXT,
  LABEL_NAMES,
  LABEL_ORDER,
  LABEL_TITLES,
  MARKDOWN_FILE,
  REPORT_FILE,
  STOP_REASON_TEXT,
  SUMMARY_FILE,
  SummaryError,
  actionText,
  buildSummary,
  causedFailureText,
  checkStatusText,
  decideResult,
  durationText,
  formatMs,
  headlineOf,
  listText,
  named,
  readSummary,
  relativeHref,
  renderReport,
  writeFileAtomic,
  writeSummary,
}
