"use strict"
/* global module */

// The journeys phase lists the probe attempts again, because both phases
// share one list. One journey, device, and attempt number keeps its first record.
function mergeAttempts(first, later) {
  const key = (item) =>
    JSON.stringify([item?.journey, item?.deviceId, item?.attempt])
  const seen = new Set(first.map(key))
  return [...first, ...later.filter((item) => !seen.has(key(item)))]
}

// KTD16: the list changes that the run's results call for. The runner never
// applies them; the mobile owner approves each one through a commit.
function proposeActions({ attempts, staleKnownBugs, screens, logLines }) {
  const lastAttempts = new Map()
  for (const item of attempts) {
    const key = JSON.stringify([item.journey, item.deviceId])
    const earlier = lastAttempts.get(key)
    if (!earlier || item.attempt >= earlier.attempt) {
      lastAttempts.set(key, item)
    }
  }
  const addKnownBugs = [...lastAttempts.values()]
    .filter((item) => item.label === "new")
    .map((item) => ({
      type: "add_known_bug",
      reason:
        "The journey failed on this device, and no Known-Bug entry matches the failure.",
      journey: item.journey,
      devices: [item.deviceId],
      step: item.failedStep,
      check: item.class,
      ticket: null,
    }))
  const removeKnownBugs = staleKnownBugs.map((entry) => ({
    type: "remove_known_bug",
    reason:
      "The journey passed on the first try on each device of this entry that ran it.",
    journey: entry.journey,
    devices: entry.devices,
    step: entry.step,
    check: entry.check,
    ticket: entry.ticket,
  }))
  const searches = new Map()
  for (const line of logLines) {
    if (line?.route !== "missing-search-answer" || !line.search) continue
    const { query, limit, offset, language } = line.search
    const search = { query, limit, offset, language }
    searches.set(JSON.stringify(search), search)
  }
  const recordSearches = [...searches.values()].map((search) => ({
    type: "record_search_answer",
    reason: "The app sent this search, and no saved answer matches it.",
    search,
  }))
  const writeJourneys = (screens?.gaps ?? []).map((gap) => ({
    type: "write_journey",
    reason:
      "No journey asserts this screen on this platform, and the Not-Tested List does not name it.",
    screen: gap.screen,
    platform: gap.platform,
  }))
  return [
    ...addKnownBugs,
    ...removeKnownBugs,
    ...recordSearches,
    ...writeJourneys,
  ]
}

function unattributedRefusal(item) {
  return {
    ts: item.ts,
    field: item.field,
    deviceId: item.deviceId ?? null,
    journey: null,
    attempt: null,
  }
}

function toolVersions(observed) {
  const versions = { node: process.versions.node }
  for (const [key, value] of Object.entries(observed ?? {})) {
    if (key === "hostTimezone" || key === "simulatorHardwareKeyboard") continue
    if (value !== null && value !== undefined && String(value) !== "") {
      versions[key] = String(value)
    }
  }
  return versions
}

function devicePins(devicesConfig, devices, observed = {}) {
  return Object.fromEntries(
    devices.map((device) => {
      const own =
        device.platform === "ios"
          ? {
              deviceType: device.deviceType,
              runtime: device.runtime,
              observedRuntime: observed.iosRuntime ?? null,
              observedHardwareKeyboard:
                observed.simulatorHardwareKeyboard ?? null,
            }
          : {
              profile: device.profile,
              image: device.image,
              observedImageRevision: observed.androidImageRevision ?? null,
              observedEmulator: observed.emulator ?? null,
            }
      return [device.id, { ...devicesConfig.pins, ...own }]
    }),
  )
}

module.exports = {
  devicePins,
  mergeAttempts,
  proposeActions,
  toolVersions,
  unattributedRefusal,
}
