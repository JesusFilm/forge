"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The retry rules of the failure diagram (KTD14, R11, R27, AE5, AE6). Each
// failed attempt goes through one decision before the next attempt; a device
// restart counts as the one retry, and a pass after any retry is "flaky".

const { matchKnownBug } = require("./knownBugs")

const MAX_ATTEMPTS = 2
const PASSING_LABELS = Object.freeze(["pass", "flaky"])
// Classes whose cause is production admin, so the retry waits for it first.
const WAIT_CLASSES = Object.freeze(["rate_limited", "upstream_error"])
const NOT_RUN_REASON = Object.freeze({
  stopped: "The run stopped before this journey.",
  deviceLost:
    "The device stopped answering after its two restarts, so this journey did not run.",
  probeFailed:
    "The settings probe failed on this device, so this journey did not run.",
  deviceNotStarted: "The run stopped before this device started.",
})

function attemptRecord(fields) {
  return {
    journey: fields.journey,
    deviceId: fields.deviceId,
    attempt: fields.attempt ?? 1,
    status: fields.status ?? "failed",
    label: fields.label ?? "new",
    class: fields.class ?? null,
    failedStep: fields.failedStep ?? null,
    error: fields.error ?? null,
    screenshot: fields.screenshot ?? null,
    stepTimes: fields.stepTimes ?? [],
    restart: fields.restart ?? false,
    notRunSteps: fields.notRunSteps ?? [],
    knownBugTicket: fields.knownBugTicket ?? null,
    screensReached: fields.screensReached ?? [],
  }
}

function notRunRecord(journey, deviceId, error, attempt = 1) {
  return attemptRecord({
    journey,
    deviceId,
    attempt,
    status: "not_run",
    label: "not_run",
    error,
  })
}

// Runs one journey on one device. `runAttempt(n, { afterRestart })` resolves
// `{ stopped }` or `{ passed, record, deviceAnswered, retryAfterMs }`;
// `recover(reason)` restarts a device that does not answer, within its budget.
async function runJourney(input) {
  const { journey, deviceId } = input
  const records = []
  let afterRestart = false
  const finish = (label, extra = {}) => {
    for (const record of records) record.label = label
    return {
      attempts: records,
      label,
      deviceLost: false,
      stopped: false,
      ...extra,
    }
  }
  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    const outcome = await input.runAttempt(n, { afterRestart })
    if (outcome.stopped) {
      records.push(
        notRunRecord(
          journey,
          deviceId,
          "The run stopped during this attempt.",
          n,
        ),
      )
      return finish("not_run", { stopped: true })
    }
    const record = outcome.record
    records.push(record)
    if (outcome.passed) {
      return finish(n === 1 && !afterRestart ? "pass" : "flaky")
    }
    if (!outcome.deviceAnswered) {
      const revived = await input.recover(
        `${journey} attempt ${n}: ${record.error ?? "the device did not answer"}`,
      )
      record.restart = revived.restarted
      if (!revived.answered) return finish("new", { deviceLost: true })
      if (revived.restarted) {
        if (n === MAX_ATTEMPTS) return finish("new")
        afterRestart = true
        continue
      }
    }
    const known = matchKnownBug(input.knownBugs, {
      journey,
      deviceId,
      step: record.failedStep,
      check: record.class,
    })
    await input.cleanUp()
    if (known) {
      record.knownBugTicket = known.ticket
      return finish("known")
    }
    if (n === MAX_ATTEMPTS) return finish("new")
    if (WAIT_CLASSES.includes(record.class)) {
      await input.wait(outcome.retryAfterMs)
    }
  }
  return finish("new")
}

async function runQueue({ deviceId, journeys, runOne, probeId }) {
  const attempts = []
  for (const [index, journey] of journeys.entries()) {
    const result = await runOne(journey)
    attempts.push(...result.attempts)
    const probeFailed =
      journey === probeId && !PASSING_LABELS.includes(result.label)
    if (!result.deviceLost && !result.stopped && !probeFailed) continue
    let why = NOT_RUN_REASON.stopped
    if (result.deviceLost) {
      why = NOT_RUN_REASON.deviceLost
    } else if (probeFailed) {
      why = NOT_RUN_REASON.probeFailed
    }
    for (const rest of journeys.slice(index + 1)) {
      attempts.push(notRunRecord(rest, deviceId, why))
    }
    return {
      attempts,
      deviceLost: result.deviceLost,
      stopped: result.stopped,
      probeFailed,
    }
  }
  return { attempts, deviceLost: false, stopped: false, probeFailed: false }
}

module.exports = {
  MAX_ATTEMPTS,
  NOT_RUN_REASON,
  attemptRecord,
  notRunRecord,
  runJourney,
  runQueue,
}
