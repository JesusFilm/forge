"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The retry rules of the failure diagram (KTD14, R11, R27, AE5, AE6). Each
// failed attempt goes through one decision before the next attempt; a device
// restart counts as the one retry, and a pass after any retry is "flaky".

const { matchKnownBug } = require("./knownBugs")

const MAX_ATTEMPTS = 2
const PASSING_LABELS = Object.freeze(["pass", "flaky"])

/** An attempt in the U8 `$defs.attempt` shape, with no label yet. */
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
    if (record.class === "rate_limited") await input.wait(outcome.retryAfterMs)
  }
  return finish("new")
}

// Runs a device's queue in order. A lost device, a stop, or a failed settings
// probe ends the queue, and each journey left in it gets a "not run" attempt.
async function runQueue({ deviceId, journeys, runOne, probeId }) {
  const attempts = []
  for (const [index, journey] of journeys.entries()) {
    const result = await runOne(journey)
    attempts.push(...result.attempts)
    const probeFailed =
      journey === probeId && !PASSING_LABELS.includes(result.label)
    if (!result.deviceLost && !result.stopped && !probeFailed) continue
    let why = "The run stopped before this journey."
    if (result.deviceLost) {
      why =
        "The device stopped answering after its two restarts, so this journey did not run."
    } else if (probeFailed) {
      why =
        "The settings probe failed on this device, so this journey did not run."
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
  PASSING_LABELS,
  attemptRecord,
  notRunRecord,
  runJourney,
  runQueue,
}
