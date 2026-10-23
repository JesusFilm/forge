"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, clearTimeout, module, require, setTimeout */
// One runner-owned Android emulator (KTD6, KTD15). Every adb call uses the
// SDK's own adb with `-s <serial>`, so no call can reach another session's
// emulator or phone, and every call has a deadline.

const fs = require("node:fs")

const { run } = require("../proc")
const {
  defaultSleep,
  ensureResponsive,
  lastLine,
  parseAdbDevices,
  parseIni,
  toolEnv,
  toolOutcome,
  toolPaths,
} = require("./inventory")

const TIMEOUTS = Object.freeze({
  adb: 15000,
  boot: 300000,
  bootPoll: 2000,
  install: 300000,
  kill: 15000,
  exit: 30000,
  gone: 30000,
  avdCreate: 120000,
  // The emulator lives for the whole run; stopAll() ends it on the end path.
  lifetime: 24 * 60 * 60 * 1000,
})
const NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
const LAUNCHER = "android.intent.category.LAUNCHER"
const PROFILE_QUESTION = /custom hardware profile/i

/** `system-images;android-35;google_apis;arm64-v8a` as config.ini writes it. */
function sysdirOf(imagePackage) {
  return `${imagePackage.split(";").join("/")}/`
}

function packageFolder(sdkRoot, imagePackage) {
  return `${sdkRoot}/${imagePackage.split(";").join("/")}`
}

/** The config.ini keys that setup pins on each runner AVD (KTD15). */
function avdPinValues(pins) {
  return {
    "hw.ramSize": String(pins.memoryMb),
    "hw.keyboard": pins.hwKeyboard ? "yes" : "no",
    "hw.gpu.enabled": "yes",
    "hw.gpu.mode": pins.gpuMode,
  }
}

function sameValue(key, have, want) {
  if (have === undefined) return false
  if (key === "hw.ramSize") return Number.parseInt(have, 10) === Number(want)
  return have.trim().toLowerCase() === want.toLowerCase()
}

// A wrong image or profile is `fixed`: setup names it and never changes it.
// Setup may write a pin key, because only setup sets those keys.
function avdMismatches(settings, device, pins) {
  const fixed = []
  const wantImage = sysdirOf(device.image)
  if (settings["image.sysdir.1"] !== wantImage) {
    fixed.push(
      `image is ${settings["image.sysdir.1"] ?? "unset"}, and the pin is ${wantImage}`,
    )
  }
  if (settings["hw.device.name"] !== device.profile) {
    fixed.push(
      `profile is ${settings["hw.device.name"] ?? "unset"}, and the pin is ${device.profile}`,
    )
  }
  const pinKeys = Object.entries(avdPinValues(pins))
    .filter(([key, want]) => !sameValue(key, settings[key], want))
    .map(([key, want]) => ({ key, have: settings[key] ?? null, want }))
  return { fixed, pins: pinKeys }
}

/** Writes the pin keys into config.ini and keeps every other line. */
function applyAvdPins(configFile, pins) {
  const values = avdPinValues(pins)
  const written = new Set()
  const lines = fs
    .readFileSync(configFile, "utf8")
    .split("\n")
    .map((line) => {
      const match = /^\s*([^#=\s][^=]*?)\s*=/.exec(line)
      if (!match || !Object.hasOwn(values, match[1])) return line
      written.add(match[1])
      return `${match[1]}=${values[match[1]]}`
    })
  while (lines.length > 0 && lines.at(-1) === "") lines.pop()
  for (const [key, value] of Object.entries(values)) {
    if (!written.has(key)) lines.push(`${key}=${value}`)
  }
  fs.writeFileSync(configFile, `${lines.join("\n")}\n`)
  return parseIni(fs.readFileSync(configFile, "utf8"))
}

function emulatorArgs(device, pins) {
  return [
    "-avd",
    device.avd,
    "-port",
    String(device.consolePort),
    "-no-snapshot-load",
    "-no-snapshot-save",
    "-memory",
    String(pins.memoryMb),
    "-no-boot-anim",
    "-no-audio",
    "-timezone",
    pins.timezone,
  ]
}

function boundedWait(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  return Promise.race([promise.then(() => true), timeout]).finally(() =>
    clearTimeout(timer),
  )
}

// The emulator answers on `emulator-<consolePort>`, a port outside the range
// that other sessions use by default.
function createEmulator(device, options = {}) {
  const runChild = options.runChild ?? run
  const env = options.env ?? toolEnv()
  const paths = options.paths ?? toolPaths(env)
  const pins = options.pins
  const timeouts = { ...TIMEOUTS, ...options.timeouts }
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const serial = `emulator-${device.consolePort}`
  let emulator = null

  async function adb(step, args, timeoutMs = timeouts.adb) {
    const result = await runChild(paths.adb, ["-s", serial, ...args], {
      env,
      timeoutMs,
    })
    return toolOutcome(result, step, timeoutMs)
  }

  async function listed() {
    const result = await runChild(paths.adb, ["devices"], {
      env,
      timeoutMs: timeouts.adb,
    })
    const outcome = toolOutcome(result, "adb devices", timeouts.adb)
    if (!outcome.ok) return null
    return parseAdbDevices(outcome.stdout).some(
      (entry) => entry.serial === serial,
    )
  }

  async function waitForBoot() {
    const end = now() + timeouts.boot
    while (now() < end) {
      if (emulator?.exit) {
        const detail =
          lastLine(emulator.exit.stderr) || lastLine(emulator.exit.stdout)
        return {
          ok: false,
          class: null,
          step: "emulator boot",
          error: `the emulator for ${device.avd} ended during boot${detail ? `: ${detail}` : ""}`,
        }
      }
      const probe = await handle.probe()
      if (probe.ok) return { ok: true }
      await sleep(timeouts.bootPoll)
    }
    return {
      ok: false,
      class: "device_unresponsive",
      step: "emulator boot",
      error: `${device.avd} did not finish booting within ${Math.round(timeouts.boot / 1000)} s`,
    }
  }

  async function waitGone() {
    const end = now() + timeouts.gone
    while (now() < end) {
      if ((await listed()) === false) return true
      await sleep(1000)
    }
    return (await listed()) === false
  }

  const handle = {
    id: device.id,
    platform: "android",
    lane: device.lane,
    avd: device.avd,
    serial,
    hostPort: device.hostPort,
    restarts: 0,

    async boot() {
      const inUse = await listed()
      if (inUse !== false) {
        return {
          ok: false,
          class: null,
          step: "emulator boot",
          error:
            inUse === null
              ? "adb devices did not answer, so the runner cannot check its port"
              : `${serial} is already in use, so the runner does not start ${device.avd} on it`,
        }
      }
      const controller = new AbortController()
      const started = { controller, exit: null, done: null }
      started.done = runChild(paths.emulator, emulatorArgs(device, pins), {
        env,
        timeoutMs: timeouts.lifetime,
        logFile: options.logFile,
        signal: controller.signal,
      }).then((result) => {
        started.exit = result
      })
      emulator = started
      const ready = await waitForBoot()
      if (!ready.ok) {
        await handle.shutdown()
        return ready
      }
      return handle.reverse()
    },

    async shutdown() {
      await adb("adb emu kill", ["emu", "kill"], timeouts.kill)
      if (emulator) {
        const ended = await boundedWait(emulator.done, timeouts.exit)
        if (!ended) {
          emulator.controller.abort()
          await emulator.done
        }
        emulator = null
      }
      if (await waitGone()) return { ok: true }
      return {
        ok: false,
        class: "device_unresponsive",
        step: "emulator stop",
        error: `${serial} is still listed by adb after the stop`,
      }
    },

    async probe() {
      const outcome = await adb("adb getprop", [
        "shell",
        "getprop",
        "sys.boot_completed",
      ])
      if (!outcome.ok) return outcome
      if (outcome.stdout.trim() === "1") return outcome
      return {
        ...outcome,
        ok: false,
        error: `${device.avd} has not finished booting`,
      }
    },

    reverse() {
      return adb("adb reverse", [
        "reverse",
        `tcp:${device.devicePort}`,
        `tcp:${device.hostPort}`,
      ])
    },

    // README section 2: Maestro's own denial does not stop the Android 15
    // dialog, so the runner clears the app and fixes the denial itself.
    async prepareApp(appId) {
      const steps = [
        ["am force-stop", ["shell", "am", "force-stop", appId]],
        ["pm clear", ["shell", "pm", "clear", appId]],
        ["pm revoke", ["shell", "pm", "revoke", appId, NOTIFICATIONS]],
        [
          "pm set-permission-flags",
          [
            "shell",
            "pm",
            "set-permission-flags",
            appId,
            NOTIFICATIONS,
            "user-set",
            "user-fixed",
          ],
        ],
      ]
      for (const [step, args] of steps) {
        const outcome = await adb(step, args)
        if (!outcome.ok) return outcome
      }
      return handle.reverse()
    },

    install(apkPath) {
      return adb("adb install", ["install", "-r", apkPath], timeouts.install)
    },

    launch(appId) {
      return adb("adb launch", [
        "shell",
        "monkey",
        "-p",
        appId,
        "-c",
        LAUNCHER,
        "1",
      ])
    },

    terminate(appId) {
      return adb("am force-stop", ["shell", "am", "force-stop", appId])
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

// avdmanager gets an empty stdin, so a hardware-profile question ends the
// call; the result then names the command to run by hand.
async function createAvd(device, options = {}) {
  const runChild = options.runChild ?? run
  const env = options.env ?? toolEnv()
  const paths = options.paths ?? toolPaths(env)
  const timeoutMs = options.timeoutMs ?? TIMEOUTS.avdCreate
  const args = [
    "create",
    "avd",
    "-n",
    device.avd,
    "-k",
    device.image,
    "-d",
    device.profile,
  ]
  const result = await runChild(paths.avdmanager, args, { env, timeoutMs })
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  if (PROFILE_QUESTION.test(output)) {
    return {
      ok: false,
      class: null,
      step: "avdmanager create",
      profileQuestion: true,
      command: `"${paths.avdmanager}" ${args.map((arg) => (/[;\s]/.test(arg) ? `"${arg}"` : arg)).join(" ")}`,
      error: "avdmanager asked about a custom hardware profile",
    }
  }
  return toolOutcome(result, "avdmanager create", timeoutMs)
}

module.exports = {
  TIMEOUTS,
  applyAvdPins,
  avdMismatches,
  createAvd,
  createEmulator,
  packageFolder,
}
