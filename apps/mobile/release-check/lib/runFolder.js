"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global clearInterval, module, require, setInterval */
// The run folder (KTD13): `<home>/runs/<runId>/` holds status.json (the live
// state), events.jsonl (one line per phase and notable event), run.json, and
// the report. A person zips this folder, so no build output goes in it.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const { RUNS_DIR } = require("./report/retention")
const { writeFileAtomic } = require("./report/summary")

const STATUS_FILE = "status.json"
const EVENTS_FILE = "events.jsonl"
const RUN_FILE = "run.json"
const RUNNER_LOG = "runner.log"
const SERVER_LOG = "server-log.jsonl"
const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{4}$/

/** `2026-10-22T02-10-00Z-1a2b`: UTC time with no milliseconds, and 4 hex. */
function newRunId(
  date = new Date(),
  hex = crypto.randomBytes(2).toString("hex"),
) {
  const time = date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-")
  return `${time}-${hex}`
}

function runDirOf(home, runId) {
  return path.join(home, RUNS_DIR, runId)
}

/** The newest run folder by its id, which starts with its UTC start time. */
function newestRunDir(home) {
  const runsDir = path.join(home, RUNS_DIR)
  if (!fs.existsSync(runsDir)) return null
  const ids = fs
    .readdirSync(runsDir)
    .filter((name) => RUN_ID_PATTERN.test(name))
    .sort()
  return ids.length === 0 ? null : path.join(runsDir, ids[ids.length - 1])
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readStatus(runDir) {
  return readJsonOrNull(path.join(runDir, STATUS_FILE))
}

function readRunFile(runDir) {
  return readJsonOrNull(path.join(runDir, RUN_FILE))
}

function writeRunFile(runDir, record) {
  writeJson(path.join(runDir, RUN_FILE), record)
}

function appendEvent(runDir, event) {
  fs.appendFileSync(
    path.join(runDir, EVENTS_FILE),
    `${JSON.stringify(event)}\n`,
  )
}

/** Every readable line of events.jsonl; a torn last line is skipped. */
function readEvents(runDir) {
  let text
  try {
    text = fs.readFileSync(path.join(runDir, EVENTS_FILE), "utf8")
  } catch {
    return []
  }
  const events = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A runner killed during a write leaves a torn line.
    }
  }
  return events
}

function completedPhasesFrom(events) {
  return events
    .filter((event) => event.type === "phase_done")
    .map((event) => event.phase)
}

// Writes status.json on each phase change and on each heartbeat. A failed
// write never throws: a throw from a timer would end the run with no report.
function createRunRecorder(
  runDir,
  { runId, pid, startedAt, now, heartbeatMs },
) {
  const iso = () => new Date(now()).toISOString()
  let status = {
    schemaVersion: 1,
    runId,
    pid,
    startedAt,
    phase: "holding",
    phaseStartedAt: startedAt,
    heartbeatAt: startedAt,
    stopReason: null,
    result: null,
    exitCode: null,
    refusals: [],
  }
  let timer = null
  const errors = []

  function safe(write) {
    try {
      write()
    } catch (error) {
      errors.push(error.message)
    }
  }

  function writeStatus(fields) {
    status = { ...status, ...fields, heartbeatAt: iso() }
    safe(() => writeJson(path.join(runDir, STATUS_FILE), status))
  }

  function event(fields) {
    safe(() => appendEvent(runDir, { ts: iso(), ...fields }))
  }

  return {
    status: () => status,
    errors: () => [...errors],
    event,
    phase(name) {
      writeStatus({ phase: name, phaseStartedAt: iso() })
      event({ type: "phase", phase: name })
    },
    phaseDone(name) {
      event({ type: "phase_done", phase: name })
    },
    write: writeStatus,
    startHeartbeat() {
      timer = setInterval(() => writeStatus({}), heartbeatMs)
      timer.unref?.()
    },
    stopHeartbeat() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

module.exports = {
  RUNNER_LOG,
  SERVER_LOG,
  STATUS_FILE,
  completedPhasesFrom,
  createRunRecorder,
  newRunId,
  newestRunDir,
  readEvents,
  readJsonOrNull,
  readRunFile,
  readStatus,
  runDirOf,
  writeJson,
  writeRunFile,
}
