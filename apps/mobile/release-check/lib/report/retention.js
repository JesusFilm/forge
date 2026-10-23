"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The runner home keeps the newest run reports (KTD16). A run folder with no
// readable summary.json is never removed: it is a run that is still going, or
// an orphan that `recover` has not reported yet.

const fs = require("node:fs")
const path = require("node:path")

const { SUMMARY_FILE, writeFileAtomic } = require("./summary")

const RUNS_DIR = "runs"
const LATEST_FILE = "latest.json"
const DEFAULT_KEEP = 5

function startedAtOf(runDir) {
  try {
    const summary = JSON.parse(
      fs.readFileSync(path.join(runDir, SUMMARY_FILE), "utf8"),
    )
    const time = Date.parse(summary?.startedAt)
    return Number.isFinite(time) ? time : null
  } catch {
    return null
  }
}

function newestFirst(a, b) {
  if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt
  if (a.runId === b.runId) return 0
  return a.runId < b.runId ? 1 : -1
}

// Keeps the `keep` newest reported runs under `<home>/runs/`, by the startedAt
// of each summary.json, and names the newest in `<home>/latest.json`.
function applyRetention(home, keep = DEFAULT_KEEP) {
  const runsDir = path.join(home, RUNS_DIR)
  const entries = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir, { withFileTypes: true })
    : []
  const reported = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      runId: entry.name,
      startedAt: startedAtOf(path.join(runsDir, entry.name)),
    }))
    .filter((run) => run.startedAt !== null)
    .sort(newestFirst)
  const kept = reported.slice(0, keep)
  const removed = reported.slice(keep)
  for (const run of removed) {
    fs.rmSync(path.join(runsDir, run.runId), { recursive: true, force: true })
  }
  const latest = kept[0] ?? null
  if (latest) {
    const pointer = {
      schemaVersion: 1,
      runId: latest.runId,
      runDir: `${RUNS_DIR}/${latest.runId}`,
    }
    writeFileAtomic(
      path.join(home, LATEST_FILE),
      `${JSON.stringify(pointer, null, 2)}\n`,
    )
  }
  return {
    kept: kept.map((run) => run.runId),
    removed: removed.map((run) => run.runId),
    latest: latest?.runId ?? null,
  }
}

module.exports = { DEFAULT_KEEP, RUNS_DIR, applyRetention }
