"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const fs = require("node:fs")
const path = require("node:path")

const { EXIT, refuseMode } = require("./contract")
const lockLib = require("./lock")
const { refuseStaleLock } = require("./plan")
const proc = require("./proc")
const { DEFAULT_KEEP } = require("./report/retention")
const { MARKDOWN_FILE, SUMMARY_FILE } = require("./report/summary")
const runFolder = require("./runFolder")

async function stopCommand(command, deps) {
  const lock = await deps.lock.inspect()
  if (lock.state === "free") {
    return refuseMode(
      deps,
      "no release check holds the lock, so no run is going",
    )
  }
  if (lock.state === "stale") {
    return refuseMode(
      deps,
      `the lock's runner (pid ${lock.lock?.pid ?? "unknown"}) ended before its end steps; run \`recover\``,
    )
  }
  if (lock.lock.mode !== "run" || !lock.lock.runId) {
    return refuseMode(
      deps,
      `the lock holder is \`${lock.lock.mode}\`, not a run`,
    )
  }
  const runDir = runFolder.runDirOf(deps.home, lock.lock.runId)
  const markdown = path.join(runDir, MARKDOWN_FILE)
  try {
    deps.kill(lock.lock.pid, "SIGTERM")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  deps.out(
    `release-check: sent SIGTERM to run ${lock.lock.runId} (pid ${lock.lock.pid}); waiting for its report.`,
  )
  const end = deps.now() + deps.stopWaitMs
  while (!fs.existsSync(markdown) && deps.now() < end) {
    await proc.sleep(deps.pollMs)
  }
  if (!fs.existsSync(markdown)) {
    deps.err(
      `release-check: the run did not write ${markdown} within ${Math.round(deps.stopWaitMs / 1000)} s.`,
    )
    return EXIT.failed
  }
  deps.out(`release-check: the run ended. Summary: ${markdown}`)
  return EXIT.passed
}

async function recoverCommand(command, deps) {
  const taken = await deps.lock.acquire({ mode: "recover", pid: deps.pid })
  if (!taken.ok) {
    return refuseMode(
      deps,
      `a live \`${taken.lock.mode}\` (pid ${taken.lock.pid}) holds the lock; use \`stop\` to end a run`,
    )
  }
  try {
    const orphan = taken.replaced
    if (orphan?.mode === "record-search") {
      await deps.devices.stopOwned(await deps.devices.list())
      deps.out(
        `release-check recover: removed the stale record-search lock of pid ${orphan.pid} and stopped the runner's devices.`,
      )
      return EXIT.passed
    }
    if (!orphan || orphan.mode !== "run" || !orphan.runId) {
      deps.out(
        orphan
          ? `release-check recover: removed the stale ${orphan.mode} lock of pid ${orphan.pid}.`
          : "release-check recover: no stale lock, so there is no orphan run.",
      )
      return EXIT.passed
    }
    const runDir = runFolder.runDirOf(deps.home, orphan.runId)
    if (fs.existsSync(path.join(runDir, SUMMARY_FILE))) {
      deps.out(
        `release-check recover: run ${orphan.runId} wrote its summary; removed its stale lock.`,
      )
      return EXIT.passed
    }
    await deps.devices.stopOwned(await deps.devices.list())
    const run = runFolder.readRunFile(runDir)
    if (!run) {
      deps.out(
        `release-check recover: stopped the runner's devices. Run ${orphan.runId} left no run.json, so no report can be written.`,
      )
      return EXIT.passed
    }
    const summary = deps.report.buildSummary({
      identity: {
        runId: run.runId,
        commit: run.commit,
        scope: run.scope,
        startedAt: run.startedAt,
        endedAt: new Date(deps.now()).toISOString(),
        macTimeZone: deps.macTimeZone(),
      },
      outcome: {
        stopReason: "runner_killed",
        completedPhases: runFolder.completedPhasesFrom(
          runFolder.readEvents(runDir),
        ),
      },
    })
    deps.report.writeSummary(runDir, summary)
    deps.report.renderReport(runDir)
    deps.report.applyRetention(deps.home, DEFAULT_KEEP)
    const status = runFolder.readStatus(runDir) ?? {}
    runFolder.writeJson(path.join(runDir, runFolder.STATUS_FILE), {
      ...status,
      phase: "ended",
      stopReason: summary.stopReason,
      result: summary.result,
      exitCode: summary.exitCode,
    })
    deps.out(
      `release-check recover: wrote the report of run ${orphan.runId}. Summary: ${path.join(runDir, MARKDOWN_FILE)}`,
    )
    return EXIT.passed
  } finally {
    taken.release()
  }
}

async function setupMode(command, deps) {
  if (command.flags.check) return deps.setupCommand(command)
  // A take-over would remove the lock that `recover` reads.
  const stale = refuseStaleLock(deps, await deps.lock.inspect(), "setup")
  if (stale !== null) return stale
  const taken = await deps.lock.acquire({ mode: "setup", pid: deps.pid })
  if (!taken.ok) {
    return refuseMode(
      deps,
      `another release check holds the lock (${lockLib.holderText(taken.lock, { withRun: false })})`,
    )
  }
  try {
    return await deps.setupCommand(command)
  } finally {
    taken.release()
  }
}

module.exports = {
  recoverCommand,
  setupMode,
  stopCommand,
}
