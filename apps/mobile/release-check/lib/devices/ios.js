"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// One runner-owned iOS simulator (KTD6, KTD15). Every simctl call has a
// deadline, because a hung `simctl listapps` held a device for 20 hours in
// the U1 spike, and a deadline counts as device_unresponsive.

const { run } = require("../proc")
const { XCRUN, ensureResponsive, toolEnv, toolOutcome } = require("./inventory")

const TIMEOUTS = Object.freeze({
  boot: 300000,
  shutdown: 60000,
  install: 300000,
  launch: 60000,
  terminate: 30000,
  probe: 20000,
  defaults: 20000,
})

// The locale pin is written inside the device at boot, so it changes nothing
// outside that device.
function createSimulator(device, options = {}) {
  const runChild = options.runChild ?? run
  const env = options.env ?? toolEnv()
  const timeouts = { ...TIMEOUTS, ...options.timeouts }
  const locale = options.pins?.locale ?? null

  async function simctl(step, args, timeoutMs) {
    const result = await runChild(XCRUN, ["simctl", ...args], {
      env,
      timeoutMs,
      logFile: options.logFile,
    })
    return { result, outcome: toolOutcome(result, step, timeoutMs) }
  }

  async function pinLocale() {
    if (!locale) return { ok: true }
    const language = locale.replace("_", "-")
    for (const args of [
      ["AppleLocale", "-string", locale],
      ["AppleLanguages", "-array", language],
    ]) {
      const { outcome } = await simctl(
        "simctl spawn defaults",
        ["spawn", device.udid, "defaults", "write", "-g", ...args],
        timeouts.defaults,
      )
      if (!outcome.ok) return outcome
    }
    return { ok: true }
  }

  const handle = {
    id: device.id,
    platform: "ios",
    lane: device.lane,
    name: device.name,
    udid: device.udid,
    restarts: 0,

    // `bootstatus -b` boots the device when needed and waits until it is ready.
    async boot() {
      const { outcome } = await simctl(
        "simctl bootstatus",
        ["bootstatus", device.udid, "-b"],
        timeouts.boot,
      )
      if (!outcome.ok) return outcome
      return pinLocale()
    },

    async shutdown() {
      const { result, outcome } = await simctl(
        "simctl shutdown",
        ["shutdown", device.udid],
        timeouts.shutdown,
      )
      if (/current state: Shutdown/.test(result.stderr ?? ""))
        return { ok: true }
      return outcome
    },

    async install(appPath) {
      return (
        await simctl(
          "simctl install",
          ["install", device.udid, appPath],
          timeouts.install,
        )
      ).outcome
    },

    async launch(bundleId) {
      return (
        await simctl(
          "simctl launch",
          ["launch", device.udid, bundleId],
          timeouts.launch,
        )
      ).outcome
    },

    async terminate(bundleId) {
      const { result, outcome } = await simctl(
        "simctl terminate",
        ["terminate", device.udid, bundleId],
        timeouts.terminate,
      )
      if (/found nothing to terminate/i.test(result.stderr ?? ""))
        return { ok: true }
      return outcome
    },

    // The probe asks the call that hung in the spike, so a wedged device fails it.
    async probe() {
      return (
        await simctl(
          "simctl listapps",
          ["listapps", device.udid],
          timeouts.probe,
        )
      ).outcome
    },

    async restart() {
      const stopped = await handle.shutdown()
      if (!stopped.ok) return stopped
      return handle.boot()
    },

    ensureResponsive() {
      return ensureResponsive(handle)
    },
  }
  return handle
}

/** Creates the simulator with its pinned device type and runtime (setup). */
async function createSimulatorDevice(device, options = {}) {
  const runChild = options.runChild ?? run
  const env = options.env ?? toolEnv()
  const timeoutMs = options.timeoutMs ?? 60000
  const result = await runChild(
    XCRUN,
    ["simctl", "create", device.name, device.deviceType, device.runtime],
    { env, timeoutMs },
  )
  const outcome = toolOutcome(result, "simctl create", timeoutMs)
  return outcome.ok ? { ...outcome, udid: outcome.stdout.trim() } : outcome
}

module.exports = { TIMEOUTS, createSimulator, createSimulatorDevice }
