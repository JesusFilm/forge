/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The inventory marks only "Forge RC" simulators and "forge_rc_" AVDs as the
// runner's own, and the end path stops only those (R7, AE7).
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { run } = require("../lib/proc")
const {
  listInventory,
  loadDeviceConfig,
  stopList,
  stopOwnedDevices,
} = require("../lib/devices/inventory")

const FIXTURES = path.join(__dirname, "fixtures", "devices")
const config = loadDeviceConfig()

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-inventory-"))
  tempDirs.push(dir)
  return dir
}

function writeAvd(avdHome, name, configText) {
  const folder = path.join(avdHome, `${name}.avd`)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(avdHome, `${name}.ini`), `path=${folder}\n`)
  fs.writeFileSync(path.join(folder, "config.ini"), configText)
}

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8")
}

function ok(stdout) {
  return { code: 0, timedOut: false, stopped: false, stdout, stderr: "" }
}

// A Mac with the runner's iPhone SE and phone emulator running, beside
// another session's simulator, a spike simulator, an emulator, and a phone.
function fakeMac() {
  const home = tempDir()
  const sdk = path.join(home, "sdk")
  fs.mkdirSync(path.join(sdk, "platform-tools"), { recursive: true })
  fs.writeFileSync(path.join(sdk, "platform-tools", "adb"), "")
  const avdHome = path.join(home, "avd")
  writeAvd(avdHome, "forge_rc_phone", "hw.device.name=pixel_7\n")
  writeAvd(avdHome, "Pixel_9a_API_35", "hw.device.name=pixel_9a\n")
  writeAvd(avdHome, "forge_e2e_tablet", "hw.device.name=pixel_tablet\n")
  const env = {
    HOME: home,
    ANDROID_HOME: sdk,
    ANDROID_AVD_HOME: avdHome,
    PATH: "/usr/bin:/bin",
  }
  const calls = []
  async function runChild(command, args) {
    calls.push([command, ...args])
    if (args[0] === "simctl" && args[1] === "list")
      return ok(fixture("simctl-devices.json"))
    if (command === "/bin/ps") return ok(fixture("ps.txt"))
    if (args[0] === "devices") return ok(fixture("adb-devices.txt"))
    return ok("")
  }
  return { env, calls, runChild }
}

describe("listInventory", () => {
  it("marks Forge RC devices as owned and every other device as foreign (AE7)", async () => {
    const mac = fakeMac()
    const inventory = await listInventory({
      config,
      env: mac.env,
      runChild: mac.runChild,
    })

    expect(
      inventory.owned.map((device) => [device.id, device.name ?? device.avd]),
    ).toEqual([
      ["iphone-se", "Forge RC iPhone SE"],
      ["ipad-pro-13", "Forge RC iPad Pro 13"],
      ["android-phone", "forge_rc_phone"],
    ])
    expect(
      inventory.foreign.map(
        (device) => device.name ?? device.avd ?? device.serial,
      ),
    ).toEqual([
      "iPhone 17 Pro",
      "Forge E2E iPhone SE",
      "Pixel_9a_API_35",
      "forge_e2e_tablet",
      "R58N123ABC",
    ])
    expect(inventory.missing).toEqual(["iphone-17-pro-max", "android-tablet"])
    const phone = inventory.owned.find(
      (device) => device.avd === "forge_rc_phone",
    )
    expect(phone).toMatchObject({
      running: true,
      serial: "emulator-5640",
      pid: 101,
    })
  })

  it("finds a runner emulator near the top of a long process list", async () => {
    // This Mac's `ps` printed 484 KB on 2026-10-22; run() keeps only a tail.
    const mac = fakeMac()
    const psFile = path.join(tempDir(), "ps.txt")
    const filler =
      "  999 /usr/libexec/some-daemon --with-a-long-argument-list\n".repeat(
        12000,
      )
    fs.writeFileSync(psFile, `${fixture("ps.txt")}${filler}`)
    const runChild = (command, args, options) =>
      command === "/bin/ps"
        ? run("/bin/cat", [psFile], options)
        : mac.runChild(command, args)

    const inventory = await listInventory({ config, env: mac.env, runChild })

    const phone = inventory.owned.find(
      (device) => device.avd === "forge_rc_phone",
    )
    expect(phone).toMatchObject({ running: true, serial: "emulator-5640" })
  })

  it("puts only owned running devices on the end path's stop list (AE7)", async () => {
    const mac = fakeMac()
    const inventory = await listInventory({
      config,
      env: mac.env,
      runChild: mac.runChild,
    })

    expect(
      stopList(inventory).map((device) => device.name ?? device.avd),
    ).toEqual(["Forge RC iPhone SE", "forge_rc_phone"])
  })

  it("sends stop commands to the owned devices only (AE7)", async () => {
    const mac = fakeMac()
    const inventory = await listInventory({
      config,
      env: mac.env,
      runChild: mac.runChild,
    })
    mac.calls.length = 0

    const results = await stopOwnedDevices(inventory, {
      env: mac.env,
      runChild: mac.runChild,
      sleep: async () => {},
      isAlive: () => false,
    })

    expect(mac.calls.map((call) => call.slice(1))).toEqual([
      ["simctl", "shutdown", "AAAA0000-0000-0000-0000-00000000F0RC"],
      ["-s", "emulator-5640", "emu", "kill"],
    ])
    expect(results.every((result) => result.ok)).toBe(true)
  })
})
