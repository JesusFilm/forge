"use strict"
/* global module */
// The Known-Bug List match (R28, KTD14). An entry matches a step label,
// never a step index, so a new step before the failing step keeps the match.

function matchKnownBug(entries, { journey, deviceId, step, check }) {
  if (step === null || step === undefined || check === null) return null
  return (
    (entries ?? []).find(
      (entry) =>
        entry.journey === journey &&
        Array.isArray(entry.devices) &&
        entry.devices.includes(deviceId) &&
        entry.step === step &&
        entry.check === check,
    ) ?? null
  )
}

function staleKnownBugs(entries, attempts) {
  return (entries ?? []).filter((entry) => {
    const ran = attempts.filter(
      (attempt) =>
        attempt.journey === entry.journey &&
        Array.isArray(entry.devices) &&
        entry.devices.includes(attempt.deviceId) &&
        attempt.status !== "not_run",
    )
    return ran.length > 0 && ran.every((attempt) => attempt.label === "pass")
  })
}

module.exports = { matchKnownBug, staleKnownBugs }
