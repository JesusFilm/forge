"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// Lists every simulator and emulator on the Mac and marks the runner's own by
// name (KTD15). The end path stops only owned devices, never another
// session's (R7, AE7). The shared device helpers live here too.

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { run, sleep: defaultSleep } = require("../proc")

const CONFIG_DIR = path.resolve(__dirname, "../../config")
const DEVICES_FILE = path.join(CONFIG_DIR, "devices.json")
const TEST_SETTINGS_FILE = path.join(CONFIG_DIR, "test-settings.json")
const XCRUN = "/usr/bin/xcrun"
const LIST_TIMEOUT_MS = 30000
// run() keeps only a 64 KB tail. On the owner's Mac `ps` printed 484 KB and
// `simctl list -j devicetypes` 62 KB, so a list read takes a larger tail.
const LIST_TAIL_BYTES = 16 * 1024 * 1024
const STOP_TIMEOUT_MS = 60000
const GONE_WAIT_MS = 30000
const GONE_POLL_MS = 1000
// KTD14: a device restart is the one retry, and each device gets two per run.
const RESTARTS_PER_RUN = 2
const LANE_PORT_NAMES = Object.freeze({
  ios: "hostIos",
  androidPhone: "hostAndroidPhone",
  androidTablet: "hostAndroidTablet",
})
const PASSED_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "JAVA_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "ANDROID_USER_HOME",
  "ANDROID_AVD_HOME",
  "ANDROID_EMULATOR_HOME",
  "DEVELOPER_DIR",
]

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function loadDeviceConfig(file = DEVICES_FILE) {
  return readJson(file)
}

/** The device port and the host port of each lane (KTD6), from test-settings.json. */
function loadPorts(file = TEST_SETTINGS_FILE) {
  const ports = readJson(file).ports
  return {
    device: ports.device,
    lanes: Object.fromEntries(
      Object.entries(LANE_PORT_NAMES).map(([lane, name]) => [
        lane,
        ports[name],
      ]),
    ),
  }
}

function simulatorPrefix(config) {
  return `${config.namePrefix} `
}

// The same rule as checkDevices in lists.js: "Forge RC" gives "forge_rc_".
function avdPrefix(config) {
  return `${config.namePrefix.toLowerCase().replace(/\s+/g, "_")}_`
}

function toolPaths(env) {
  const home = env.HOME ?? os.homedir()
  const sdkRoot =
    env.ANDROID_HOME ||
    env.ANDROID_SDK_ROOT ||
    path.join(home, "Library/Android/sdk")
  const userHome = env.ANDROID_USER_HOME || path.join(home, ".android")
  return {
    sdkRoot,
    adb: path.join(sdkRoot, "platform-tools/adb"),
    emulator: path.join(sdkRoot, "emulator/emulator"),
    sdkmanager: path.join(sdkRoot, "cmdline-tools/latest/bin/sdkmanager"),
    avdmanager: path.join(sdkRoot, "cmdline-tools/latest/bin/avdmanager"),
    avdHome: env.ANDROID_AVD_HOME || path.join(userHome, "avd"),
  }
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function resolveOnPath(name, pathValue) {
  for (const dir of String(pathValue ?? "").split(":")) {
    if (dir && isExecutable(path.join(dir, name))) return path.join(dir, name)
  }
  return null
}

/** The only environment that device tools get: a fixed PATH plus named keys. */
function toolEnv(source = process.env, overrides = {}) {
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" }
  for (const key of PASSED_ENV_KEYS) {
    if (source[key]) env[key] = source[key]
  }
  Object.assign(env, overrides)
  if (env.JAVA_HOME) env.PATH = `${path.join(env.JAVA_HOME, "bin")}:${env.PATH}`
  return env
}

function lastLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.at(-1) ?? ""
}

/** A deadline is `device_unresponsive` (README, "What the runner must do"). */
function toolOutcome(result, step, timeoutMs) {
  if (result.timedOut) {
    return {
      ok: false,
      class: "device_unresponsive",
      step,
      error: `${step} did not answer within ${Math.round(timeoutMs / 1000)} s`,
      stdout: result.stdout,
    }
  }
  if (result.stopped) {
    return { ok: false, class: null, step, error: `${step} was stopped` }
  }
  if (result.code !== 0) {
    const detail = lastLine(result.stderr) || lastLine(result.stdout)
    return {
      ok: false,
      class: null,
      step,
      error: `${step} failed${result.error ? `: ${result.error}` : ""}${detail ? `: ${detail}` : ""}`,
      stdout: result.stdout,
    }
  }
  return { ok: true, class: null, step, error: null, stdout: result.stdout }
}

// The restart helper (R11, KTD14, AE6) leaves a device that answers alone,
// so an app that hangs on a live device stays a journey failure.
async function ensureResponsive(handle) {
  const probe = await handle.probe()
  if (probe.ok) {
    return {
      answered: true,
      restarted: false,
      restarts: handle.restarts,
      exhausted: false,
      error: null,
    }
  }
  if (handle.restarts >= RESTARTS_PER_RUN) {
    return {
      answered: false,
      restarted: false,
      restarts: handle.restarts,
      exhausted: true,
      error: probe.error,
    }
  }
  handle.restarts += 1
  const restart = await handle.restart()
  return {
    answered: restart.ok,
    restarted: true,
    restarts: handle.restarts,
    exhausted: false,
    error: restart.ok ? null : restart.error,
  }
}

// ── Listing ──────────────────────────────────────────────────────────

function parseSimulators(json, config) {
  const prefix = simulatorPrefix(config)
  const byName = new Map(
    config.devices
      .filter((device) => device.platform === "ios")
      .map((device) => [device.name, device]),
  )
  const owned = []
  const foreign = []
  for (const [runtime, devices] of Object.entries(json.devices ?? {})) {
    for (const device of devices) {
      const entry = {
        platform: "ios",
        name: device.name,
        udid: device.udid,
        state: device.state,
        running: device.state === "Booted",
        runtime,
        deviceType: device.deviceTypeIdentifier ?? null,
        available: device.isAvailable !== false,
      }
      if (device.name.startsWith(prefix)) {
        owned.push({ id: byName.get(device.name)?.id ?? null, ...entry })
      } else {
        foreign.push(entry)
      }
    }
  }
  return { owned, foreign }
}

function parseIni(text) {
  const values = {}
  for (const line of String(text).split("\n")) {
    const match = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

function avdDirectory(avdHome, name) {
  const iniFile = path.join(avdHome, `${name}.ini`)
  try {
    const ini = parseIni(fs.readFileSync(iniFile, "utf8"))
    if (ini.path) return ini.path
  } catch {
    // An AVD with no top-level ini file uses the default folder.
  }
  return path.join(avdHome, `${name}.avd`)
}

function readAvdConfig(avdHome, name) {
  const file = path.join(avdDirectory(avdHome, name), "config.ini")
  try {
    return { file, values: parseIni(fs.readFileSync(file, "utf8")) }
  } catch {
    return { file, values: null }
  }
}

function listAvdNames(avdHome) {
  let names
  try {
    names = fs.readdirSync(avdHome)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(".ini"))
    .map((name) => name.slice(0, -".ini".length))
    .sort()
}

/** Reads `-avd <name>` and the console port from each emulator process. */
function parseEmulatorProcesses(psText) {
  const processes = []
  for (const line of String(psText).split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match || !/qemu-system/.test(match[2])) continue
    const args = match[2].split(/\s+/)
    const avdIndex = args.indexOf("-avd")
    if (avdIndex === -1) continue
    let port = null
    const portIndex = args.indexOf("-port")
    const portsIndex = args.indexOf("-ports")
    if (portIndex !== -1) port = Number(args[portIndex + 1])
    else if (portsIndex !== -1)
      port = Number(args[portsIndex + 1].split(",")[0])
    processes.push({
      pid: Number(match[1]),
      avd: args[avdIndex + 1],
      consolePort: Number.isInteger(port) ? port : null,
    })
  }
  return processes
}

function parseAdbDevices(text) {
  const devices = []
  for (const line of String(text).split("\n").slice(1)) {
    const [serial, state] = line.trim().split(/\s+/)
    if (serial && state) devices.push({ serial, state })
  }
  return devices
}

// It only reads; `adb devices` asks the adb server and touches no device.
async function listInventory(options = {}) {
  const config = options.config ?? loadDeviceConfig()
  const env = options.env ?? toolEnv()
  const runChild = options.runChild ?? run
  const paths = options.paths ?? toolPaths(env)
  const errors = []

  const simctl = await runChild(XCRUN, ["simctl", "list", "-j", "devices"], {
    env,
    timeoutMs: LIST_TIMEOUT_MS,
    tailBytes: LIST_TAIL_BYTES,
  })
  const simOutcome = toolOutcome(simctl, "simctl list", LIST_TIMEOUT_MS)
  let simulators = { owned: [], foreign: [] }
  if (simOutcome.ok) {
    simulators = parseSimulators(JSON.parse(simOutcome.stdout), config)
  } else {
    errors.push({
      tool: "simctl",
      class: simOutcome.class,
      message: simOutcome.error,
    })
  }

  const ps = await runChild("/bin/ps", ["-axww", "-o", "pid=,command="], {
    env,
    timeoutMs: LIST_TIMEOUT_MS,
    tailBytes: LIST_TAIL_BYTES,
  })
  const processes = ps.code === 0 ? parseEmulatorProcesses(ps.stdout) : []
  if (ps.code !== 0)
    errors.push({ tool: "ps", class: null, message: "ps failed" })

  let adbDevices = []
  if (fs.existsSync(paths.adb)) {
    const adb = await runChild(paths.adb, ["devices"], {
      env,
      timeoutMs: LIST_TIMEOUT_MS,
    })
    const adbOutcome = toolOutcome(adb, "adb devices", LIST_TIMEOUT_MS)
    if (adbOutcome.ok) adbDevices = parseAdbDevices(adbOutcome.stdout)
    else
      errors.push({
        tool: "adb",
        class: adbOutcome.class,
        message: adbOutcome.error,
      })
  }
  const adbState = new Map(
    adbDevices.map((device) => [device.serial, device.state]),
  )

  const prefix = avdPrefix(config)
  const byAvd = new Map(
    config.devices
      .filter((device) => device.platform === "android")
      .map((device) => [device.avd, device]),
  )
  const ownedAvds = []
  const foreignAvds = []
  const avdNames = new Set([
    ...listAvdNames(paths.avdHome),
    ...processes.map((process) => process.avd),
  ])
  const claimedSerials = new Set()
  for (const name of [...avdNames].sort()) {
    const process = processes.find((entry) => entry.avd === name) ?? null
    const serial = process?.consolePort
      ? `emulator-${process.consolePort}`
      : null
    if (serial) claimedSerials.add(serial)
    const entry = {
      platform: "android",
      avd: name,
      running: process !== null,
      pid: process?.pid ?? null,
      serial,
      adbState: serial ? (adbState.get(serial) ?? null) : null,
    }
    if (name.startsWith(prefix)) {
      const avdConfig = readAvdConfig(paths.avdHome, name)
      ownedAvds.push({
        id: byAvd.get(name)?.id ?? null,
        ...entry,
        configFile: avdConfig.file,
        settings: avdConfig.values,
      })
    } else {
      foreignAvds.push(entry)
    }
  }
  // A physical phone or a remote device is never the runner's.
  const otherAdb = adbDevices
    .filter((device) => !device.serial.startsWith("emulator-"))
    .filter((device) => !claimedSerials.has(device.serial))
    .map((device) => ({
      platform: "android",
      avd: null,
      running: true,
      pid: null,
      serial: device.serial,
      adbState: device.state,
    }))

  const owned = [...simulators.owned, ...ownedAvds]
  const ownedIds = new Set(owned.map((device) => device.id).filter(Boolean))
  return {
    owned,
    foreign: [...simulators.foreign, ...foreignAvds, ...otherAdb],
    missing: config.devices
      .map((device) => device.id)
      .filter((id) => !ownedIds.has(id)),
    errors,
  }
}

/** The devices that the end path stops: owned and running, nothing else. */
function stopList(inventory) {
  return inventory.owned.filter((device) => device.running)
}

function runningForeign(inventory) {
  return inventory.foreign.filter((device) => device.running)
}

async function waitUntil(check, limitMs, sleep) {
  const end = Date.now() + limitMs
  while (Date.now() < end) {
    if (await check()) return true
    await sleep(GONE_POLL_MS)
  }
  return check()
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// An emulator that ignores `emu kill` gets SIGTERM, but only by the pid
// whose command line names its own `forge_rc_` AVD (R38).
async function stopOwnedDevices(inventory, options = {}) {
  const env = options.env ?? toolEnv()
  const runChild = options.runChild ?? run
  const paths = options.paths ?? toolPaths(env)
  const sleep = options.sleep ?? defaultSleep
  const alive = options.isAlive ?? isAlive
  const results = []
  for (const device of stopList(inventory)) {
    if (device.platform === "ios") {
      const result = await runChild(
        XCRUN,
        ["simctl", "shutdown", device.udid],
        {
          env,
          timeoutMs: STOP_TIMEOUT_MS,
        },
      )
      const outcome = toolOutcome(result, "simctl shutdown", STOP_TIMEOUT_MS)
      const already = /current state: Shutdown/.test(result.stderr ?? "")
      results.push({
        device: device.name,
        ok: outcome.ok || already,
        error: outcome.ok || already ? null : outcome.error,
      })
      continue
    }
    if (device.serial) {
      await runChild(paths.adb, ["-s", device.serial, "emu", "kill"], {
        env,
        timeoutMs: STOP_TIMEOUT_MS,
      })
    }
    let gone = device.pid
      ? await waitUntil(() => !alive(device.pid), GONE_WAIT_MS, sleep)
      : true
    if (!gone && device.pid) {
      process.kill(device.pid, "SIGTERM")
      gone = await waitUntil(() => !alive(device.pid), GONE_WAIT_MS, sleep)
    }
    results.push({
      device: device.avd,
      ok: gone,
      error: gone ? null : `${device.avd} did not stop`,
    })
  }
  return results
}

module.exports = {
  LANE_PORT_NAMES,
  LIST_TAIL_BYTES,
  RESTARTS_PER_RUN,
  XCRUN,
  avdPrefix,
  defaultSleep,
  ensureResponsive,
  isExecutable,
  lastLine,
  listInventory,
  loadDeviceConfig,
  loadPorts,
  parseAdbDevices,
  parseIni,
  readAvdConfig,
  resolveOnPath,
  runningForeign,
  simulatorPrefix,
  stopList,
  stopOwnedDevices,
  toolEnv,
  toolOutcome,
  toolPaths,
}
