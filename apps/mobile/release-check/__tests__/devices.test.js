/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The restart helper restarts a device that stops answering the device
// tools, and only that device (R11, KTD14, AE6). An app that hangs on a
// device that still answers stays a journey failure.
const { createEmulator } = require("../lib/devices/android")
const { loadDeviceConfig } = require("../lib/devices/inventory")
const { createSimulator } = require("../lib/devices/ios")

const PINS = loadDeviceConfig().pins
const PATHS = {
  sdkRoot: "/sdk",
  adb: "/sdk/platform-tools/adb",
  emulator: "/sdk/emulator/emulator",
  avdmanager: "/sdk/cmdline-tools/latest/bin/avdmanager",
}
const TABLET = {
  id: "android-tablet",
  avd: "forge_rc_tablet",
  consolePort: 5642,
  lane: "androidTablet",
  hostPort: 38213,
  devicePort: 38211,
}

function result(fields) {
  return {
    code: 0,
    timedOut: false,
    stopped: false,
    stdout: "",
    stderr: "",
    ...fields,
  }
}

// One tablet emulator that is running. `answers` decides if adb gets a reply.
function fakeEmulatorTools({ answers }) {
  const state = { running: true, answers, exitEmulator: null }
  const calls = []
  async function runChild(command, args) {
    calls.push([command, ...args])
    if (command === PATHS.emulator) {
      state.running = true
      state.answers = true
      return new Promise((resolve) => {
        state.exitEmulator = () => resolve(result({ code: 0 }))
      })
    }
    if (args[0] === "devices") {
      const lines = state.running ? "emulator-5642\tdevice\n" : ""
      return result({ stdout: `List of devices attached\n${lines}` })
    }
    const [flag, serial, ...rest] = args
    if (flag !== "-s" || serial !== "emulator-5642") return result({ code: 1 })
    if (rest[0] === "emu" && rest[1] === "kill") {
      state.running = false
      state.exitEmulator?.()
      return result({})
    }
    if (!state.running) return result({ code: 1, stderr: "device not found" })
    if (!state.answers) return result({ code: null, timedOut: true })
    if (rest.join(" ") === "shell getprop sys.boot_completed")
      return result({ stdout: "1\n" })
    return result({})
  }
  return { calls, runChild, state }
}

function emulatorFor(tools) {
  return createEmulator(TABLET, {
    runChild: tools.runChild,
    env: { PATH: "/usr/bin:/bin" },
    paths: PATHS,
    pins: PINS,
    sleep: async () => {},
  })
}

describe("android restart helper", () => {
  it("restarts an emulator that does not answer and maps its port again (AE6)", async () => {
    const tools = fakeEmulatorTools({ answers: false })
    const tablet = emulatorFor(tools)

    const outcome = await tablet.ensureResponsive()

    expect(outcome).toMatchObject({
      answered: true,
      restarted: true,
      restarts: 1,
    })
    const actions = tools.calls
      .map((call) => call.slice(1).join(" "))
      .filter(
        (call) =>
          !call.endsWith("shell getprop sys.boot_completed") &&
          call !== "devices",
      )
    expect(actions).toEqual([
      "-s emulator-5642 emu kill",
      `-avd forge_rc_tablet -port 5642 -no-snapshot-load -no-snapshot-save -memory ${PINS.memoryMb} -no-boot-anim -no-audio -timezone ${PINS.timezone}`,
      "-s emulator-5642 reverse tcp:38211 tcp:38213",
    ])
    const otherSerials = tools.calls.filter(
      (call) => call[1] === "-s" && call[2] !== "emulator-5642",
    )
    expect(otherSerials).toEqual([])
  })

  it("does not restart an emulator that answers, even when its app hangs (AE6)", async () => {
    const tools = fakeEmulatorTools({ answers: true })
    const tablet = emulatorFor(tools)

    const outcome = await tablet.ensureResponsive()

    expect(outcome).toMatchObject({
      answered: true,
      restarted: false,
      restarts: 0,
    })
    expect(tools.calls.map((call) => call.slice(1).join(" "))).toEqual([
      "-s emulator-5642 shell getprop sys.boot_completed",
    ])
  })

  it("stops restarting after two restarts in one run (KTD14)", async () => {
    const tools = fakeEmulatorTools({ answers: false })
    const tablet = emulatorFor(tools)

    for (const restarts of [1, 2]) {
      tools.state.answers = false
      expect(await tablet.ensureResponsive()).toMatchObject({
        restarted: true,
        restarts,
      })
    }
    tools.state.answers = false
    tools.calls.length = 0

    expect(await tablet.ensureResponsive()).toMatchObject({
      answered: false,
      restarted: false,
      exhausted: true,
      restarts: 2,
    })
    expect(tools.calls.some((call) => call.includes("kill"))).toBe(false)
  })
})

describe("android app preparation", () => {
  it("clears the app, fixes the notification denial, and maps the port again", async () => {
    const tools = fakeEmulatorTools({ answers: true })
    const tablet = emulatorFor(tools)

    expect(await tablet.prepareApp("org.jesusfilm.forgewatch")).toMatchObject({
      ok: true,
    })

    const permission = "android.permission.POST_NOTIFICATIONS"
    expect(tools.calls.map((call) => call.slice(1).join(" "))).toEqual([
      "-s emulator-5642 shell am force-stop org.jesusfilm.forgewatch",
      "-s emulator-5642 shell pm clear org.jesusfilm.forgewatch",
      `-s emulator-5642 shell pm revoke org.jesusfilm.forgewatch ${permission}`,
      `-s emulator-5642 shell pm set-permission-flags org.jesusfilm.forgewatch ${permission} user-set user-fixed`,
      "-s emulator-5642 reverse tcp:38211 tcp:38213",
    ])
  })
})

describe("ios restart helper", () => {
  const SE = {
    id: "iphone-se",
    name: "Forge RC iPhone SE",
    udid: "SE-UDID",
    lane: "ios",
  }

  function fakeSimctl({ answers }) {
    const state = { answers }
    const calls = []
    async function runChild(command, args) {
      calls.push(args.join(" "))
      if (args[1] === "listapps" && !state.answers)
        return result({ code: null, timedOut: true })
      if (args[1] === "bootstatus") state.answers = true
      return result({})
    }
    return { calls, runChild }
  }

  it("restarts a simulator whose simctl call does not answer, and only that one", async () => {
    const tools = fakeSimctl({ answers: false })
    const simulator = createSimulator(SE, {
      runChild: tools.runChild,
      pins: PINS,
    })

    expect(await simulator.ensureResponsive()).toMatchObject({
      restarted: true,
      answered: true,
    })
    expect(tools.calls.slice(0, 3)).toEqual([
      "simctl listapps SE-UDID",
      "simctl shutdown SE-UDID",
      "simctl bootstatus SE-UDID -b",
    ])
    expect(tools.calls.every((call) => call.includes("SE-UDID"))).toBe(true)
  })

  it("does not restart a simulator that answers", async () => {
    const tools = fakeSimctl({ answers: true })
    const simulator = createSimulator(SE, {
      runChild: tools.runChild,
      pins: PINS,
    })

    expect(await simulator.ensureResponsive()).toMatchObject({
      restarted: false,
    })
    expect(tools.calls).toEqual(["simctl listapps SE-UDID"])
  })
})
