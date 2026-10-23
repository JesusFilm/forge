"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// One failure class for each failed attempt (KTD14). The evidence comes from
// the device tools, the crash records of the runner's own devices only, the
// server log lines of that device inside the attempt window, and Maestro.

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { toolEnv, toolPaths } = require("../devices/inventory")
const { run } = require("../proc")

// The device clocks and the Mac clock agreed to the second on 2026-10-22;
// the margin covers a request that arrives as the attempt starts or ends.
const WINDOW_MARGIN_MS = 5000
const ADB_TIMEOUT_MS = 20000
const LOG_TAIL_BYTES = 16 * 1024 * 1024
const DEFAULT_RETRY_AFTER_MS = 60000
const REPORTS_DIR = path.join(os.homedir(), "Library/Logs/DiagnosticReports")
// ApplicationExitInfo reasons: LOW_MEMORY 3, CRASH 4, CRASH_NATIVE 5, ANR 6.
const EXIT_REASON_CLASS = Object.freeze({
  3: "memory_pressure_kill",
  4: "app_crashed",
  5: "app_crashed",
  6: "app_unresponsive",
})
const DRIVER_ERROR =
  /driver|grpc|UNAVAILABLE|Connection (?:refused|reset)|unexpected end of stream|SocketException/i
const ELEMENT_NOT_FOUND = /^Element not found/i
const APP_CRASH_MESSAGE = /App crashed|crashed while executing/i

function inWindow(ms, window) {
  return (
    Number.isFinite(ms) &&
    ms >= window.startMs - WINDOW_MARGIN_MS &&
    ms <= window.endMs + WINDOW_MARGIN_MS
  )
}

// ── Server log ───────────────────────────────────────────────────────

/** Every readable line of `server-log.jsonl`; a line it cannot read is skipped. */
function readServerLog(logPath) {
  if (!fs.existsSync(logPath)) return []
  const lines = []
  for (const text of fs.readFileSync(logPath, "utf8").split("\n")) {
    if (text.trim() === "") continue
    try {
      lines.push(JSON.parse(text))
    } catch {
      // The log check names an unreadable line; the classifier only skips it.
    }
  }
  return lines
}

/** The U3 answer codes that one device met inside the attempt window. */
function serverSignals(lines, { deviceId, startMs, endMs }) {
  const window = { startMs, endMs }
  const mine = lines.filter(
    (line) =>
      line.deviceId === deviceId && inWindow(Date.parse(line.ts), window),
  )
  const refusals = mine.filter(
    (line) => line.route === "rate-limited" || line.rateLimit,
  )
  const waits = refusals
    .map((line) => line.rateLimit?.retryAfterMs)
    .filter(Number.isFinite)
  const upstreamError = mine.some((line) => line.route === "upstream-error")
  // An upstream error has no Retry-After, so it waits as long as a refusal
  // without one.
  let retryAfterMs = upstreamError ? DEFAULT_RETRY_AFTER_MS : null
  if (refusals.length > 0) {
    retryAfterMs =
      waits.length > 0 ? Math.max(...waits) : DEFAULT_RETRY_AFTER_MS
  }
  return {
    rateLimited: refusals.length > 0,
    retryAfterMs,
    upstreamError,
    missingSearchAnswer: mine.some(
      (line) => line.route === "missing-search-answer",
    ),
    // The server blocks every write by design (R13, R15), so only a blocked
    // read, or a request that did not parse, can cause a failure.
    blocked: mine.some(
      (line) =>
        line.route === "blocked" &&
        (line.opType === "query" || line.opType == null),
    ),
  }
}

// ── iOS crash reports ────────────────────────────────────────────────

/** `2026-10-22 13:13:13.1512 +1300`, the .ips time format, in ms. */
function reportTimeMs(text) {
  const match = String(text ?? "").match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? ([+-])(\d{2})(\d{2})$/,
  )
  if (!match) return Number.NaN
  const fraction = (match[3] ?? "").slice(0, 4)
  return Date.parse(
    `${match[1]}T${match[2]}${fraction}${match[4]}${match[5]}:${match[6]}`,
  )
}

// A simulator report names its device in `coalitionName`, so a report from
// another session's simulator never matches.
function iosReportMatches(text, { udid, bundleId, startMs, endMs }) {
  const newline = text.indexOf("\n")
  if (newline < 0) return false
  let header
  let body
  try {
    header = JSON.parse(text.slice(0, newline))
    body = JSON.parse(text.slice(newline + 1))
  } catch {
    return false
  }
  if (header.bundleID !== bundleId) return false
  if (body.coalitionName !== `com.apple.CoreSimulator.SimDevice.${udid}`) {
    return false
  }
  return inWindow(reportTimeMs(body.captureTime ?? header.timestamp), {
    startMs,
    endMs,
  })
}

/** The crash reports of this app on this simulator inside the window. */
function iosCrashReports({ udid, bundleId, startMs, endMs, reportsDir }) {
  const dir = reportsDir ?? REPORTS_DIR
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(".ips"))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        return fs.statSync(file).mtimeMs >= startMs - WINDOW_MARGIN_MS
      } catch {
        return false
      }
    })
    .filter((file) =>
      iosReportMatches(fs.readFileSync(file, "utf8"), {
        udid,
        bundleId,
        startMs,
        endMs,
      }),
    )
}

// ── Android records ──────────────────────────────────────────────────

// `logcat -b events -v epoch`: `1792637920.943  577  595 I am_crash: [pid,
// uid,process,...]` and `am_anr: [user,pid,package,...]`; both name the app
// at index 2.
function androidEventClasses(text, { appId, startMs, endMs }) {
  const classes = new Set()
  for (const line of String(text).split("\n")) {
    const match = line.match(
      /^\s*(\d+)\.(\d+)\s+\d+\s+\d+\s+\w\s+(am_crash|am_anr)\s*:\s*\[(.*)\]/,
    )
    if (!match) continue
    const ms =
      Number(match[1]) * 1000 + Number(match[2].slice(0, 3).padEnd(3, "0"))
    if (!inWindow(ms, { startMs, endMs })) continue
    if (match[4].split(",")[2] !== appId) continue
    classes.add(match[3] === "am_crash" ? "app_crashed" : "app_unresponsive")
  }
  return [...classes]
}

// `dumpsys activity exit-info <app>` prints `timestamp=2026-10-22
// 02:58:40.944 pid=…` and then `process=<app> reason=4 (…)`. The emulators
// run on the Etc/UTC pin (devices.json), so the time is read as UTC.
function androidExitClasses(text, { appId, startMs, endMs }) {
  const classes = new Set()
  let stamp = Number.NaN
  for (const line of String(text).split("\n")) {
    const time = line.match(
      /timestamp=(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
    )
    if (time) {
      stamp = Date.parse(`${time[1]}T${time[2]}Z`)
      continue
    }
    const exit = line.match(/process=(\S+) reason=(\d+)/)
    if (!exit || exit[1] !== appId) continue
    const cls = EXIT_REASON_CLASS[exit[2]]
    if (cls && inWindow(stamp, { startMs, endMs })) classes.add(cls)
  }
  return [...classes]
}

async function adbText(options, args) {
  const env = options.env ?? toolEnv()
  const runChild = options.runChild ?? run
  const result = await runChild(
    toolPaths(env).adb,
    ["-s", options.serial, ...args],
    { env, timeoutMs: ADB_TIMEOUT_MS, tailBytes: LOG_TAIL_BYTES },
  )
  return result.code === 0 ? result.stdout : ""
}

/** The crash, ANR, and memory kill classes that one emulator recorded. */
async function androidEvidence(options) {
  const window = {
    appId: options.appId,
    startMs: options.startMs,
    endMs: options.endMs,
  }
  const events = await adbText(options, [
    "logcat",
    "-b",
    "events",
    "-d",
    "-v",
    "epoch",
  ])
  const exits = await adbText(options, [
    "shell",
    "dumpsys",
    "activity",
    "exit-info",
    options.appId,
  ])
  return [
    ...new Set([
      ...androidEventClasses(events, window),
      ...androidExitClasses(exits, window),
    ]),
  ]
}

// ── The class ────────────────────────────────────────────────────────

function lastLine(text) {
  return (
    String(text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("at "))
      .at(-1) ?? null
  )
}

function commandClass(failed) {
  const message = failed.error ?? ""
  if (APP_CRASH_MESSAGE.test(message)) return "app_crashed"
  if (ELEMENT_NOT_FOUND.test(message)) return "selector_not_found"
  if (failed.type === "assertConditionCommand" && !DRIVER_ERROR.test(message)) {
    return "assertion_failed"
  }
  return "driver_failed"
}

const DEVICE_CLASS_ORDER = [
  "memory_pressure_kill",
  "app_crashed",
  "app_unresponsive",
]
// A false check or a missing control can come from a read that admin did not
// answer; a crash or a driver failure cannot.
const UPSTREAM_ERROR_EXPLAINS = new Set([
  "assertion_failed",
  "selector_not_found",
])

// One class for a failed attempt, from the most direct evidence to the least:
// the device, the app's own exit records, the server, then Maestro.
function classifyFailure(input) {
  const output = input.output ?? {}
  const failed = output.failed ?? null
  const maestroText =
    failed?.error ??
    output.junitFailure ??
    lastLine(input.maestro?.stderr) ??
    lastLine(input.maestro?.stdout)
  if (input.deviceProblem) {
    return { class: "device_unresponsive", error: input.deviceProblem }
  }
  const appClass = DEVICE_CLASS_ORDER.find((cls) =>
    (input.appEvidence ?? []).includes(cls),
  )
  if (appClass) return { class: appClass, error: maestroText }
  const server = input.server ?? {}
  if (server.rateLimited) return { class: "rate_limited", error: maestroText }
  if (server.missingSearchAnswer) {
    return { class: "missing_search_answer", error: maestroText }
  }
  if (server.blocked) return { class: "request_blocked", error: maestroText }
  if (input.maestro?.timedOut) {
    return {
      class: "app_unresponsive",
      error: `The attempt did not end within ${Math.round(input.timeoutMs / 1000)} s while the device still answered.`,
    }
  }
  if (failed) {
    const cls = commandClass(failed)
    if (server.upstreamError && UPSTREAM_ERROR_EXPLAINS.has(cls)) {
      return { class: "upstream_error", error: maestroText }
    }
    return { class: cls, error: maestroText }
  }
  return {
    class: "driver_failed",
    error:
      maestroText ?? output.unreadable ?? "Maestro failed and wrote no step.",
  }
}

module.exports = {
  DEFAULT_RETRY_AFTER_MS,
  androidEventClasses,
  androidEvidence,
  androidExitClasses,
  classifyFailure,
  iosCrashReports,
  readServerLog,
  serverSignals,
}
