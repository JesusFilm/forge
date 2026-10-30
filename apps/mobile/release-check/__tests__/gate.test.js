/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, afterEach, beforeEach, describe, expect, it, require, setImmediate */
// The host gate decides how many devices run at the same time from free
// memory and load, one device per lane (R9, KTD6, AE8).
const fs = require("node:fs")
const path = require("node:path")

const { createGate, parseVmStat, planCapacity } = require("../lib/devices/gate")

const GATE = {
  reserveMb: 4000,
  estimates: {
    ios: { memoryMb: 3000, load: 1.5 },
    android: { memoryMb: 5500, load: 2 },
  },
  maxLoadPerCore: 0.75,
  settleMs: 180000,
  pollMs: 10000,
  waitLimitMs: 900000,
}

const SE = { id: "iphone-se", platform: "ios", lane: "ios" }
const PRO_MAX = { id: "iphone-17-pro-max", platform: "ios", lane: "ios" }
const IPAD = { id: "ipad-pro-13", platform: "ios", lane: "ios" }
const PHONE = { id: "android-phone", platform: "android", lane: "androidPhone" }
const TABLET = {
  id: "android-tablet",
  platform: "android",
  lane: "androidTablet",
}
const ALL = [SE, PRO_MAX, IPAD, PHONE, TABLET]

// A Mac whose devices take their memory 60 s after they start, as a booting
// emulator does, so the sample cannot see a device that just started.
function fakeMac({ freeMb, load1 = 2, cores = 12 }) {
  const clock = { t: 0 }
  const running = new Map()
  const use = { ios: 3000, android: 5500 }
  return {
    clock,
    start(device) {
      running.set(device.id, { device, at: clock.t })
    },
    stop(device) {
      running.delete(device.id)
    },
    sampleHost: async () => {
      let usedMb = 0
      for (const { device, at } of running.values()) {
        if (clock.t - at >= 60000) usedMb += use[device.platform]
      }
      return { availableMb: freeMb - usedMb, load1, cores }
    },
    now: () => clock.t,
    sleep: (ms) => {
      clock.t += ms
      return new Promise((resolve) => setImmediate(resolve))
    },
  }
}

// Each test aborts its waiting admits, so a broken gate fails the test and
// does not leave a polling loop that keeps jest alive.
let controller
beforeEach(() => {
  controller = new AbortController()
})
afterEach(() => controller.abort())

function gateFor(mac) {
  return createGate({
    gate: GATE,
    sampleHost: mac.sampleHost,
    now: mac.now,
    sleep: mac.sleep,
  })
}

async function admitAndStart(gate, mac, device) {
  const result = await gate.admit(device, { signal: controller.signal })
  if (result.admitted) mac.start(device)
  return result
}

function track(promise) {
  const state = { settled: false, value: null }
  promise.then((value) => {
    state.settled = true
    state.value = value
  })
  return state
}

async function ticks(count) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe("createGate", () => {
  it("lets the iPhone SE and both emulators run on a Mac with room, and holds the second iOS device until the first ends", async () => {
    const mac = fakeMac({ freeMb: 24000 })
    const gate = gateFor(mac)

    for (const device of [SE, PHONE, TABLET]) {
      expect(await admitAndStart(gate, mac, device)).toMatchObject({
        admitted: true,
      })
    }
    const proMax = track(gate.admit(PRO_MAX, { signal: controller.signal }))
    await ticks(50)
    expect(proMax.settled).toBe(false)
    expect(gate.running()).toEqual([
      "iphone-se",
      "android-phone",
      "android-tablet",
    ])

    gate.release(SE)
    mac.stop(SE)
    await ticks(5)
    expect(proMax).toMatchObject({ settled: true, value: { admitted: true } })
  })

  it("lets one simulator and one emulator run on a Mac with less memory, and the other devices wait their turn (AE8)", async () => {
    const mac = fakeMac({ freeMb: 14000 })
    const gate = gateFor(mac)

    expect(await admitAndStart(gate, mac, SE)).toMatchObject({ admitted: true })
    expect(await admitAndStart(gate, mac, PHONE)).toMatchObject({
      admitted: true,
    })
    const tablet = track(gate.admit(TABLET, { signal: controller.signal }))
    const proMax = track(gate.admit(PRO_MAX, { signal: controller.signal }))
    // 120 polls of 10 s pass the 15 min limit; the wait has no limit while runner devices run.
    await ticks(120)
    expect(mac.clock.t).toBeGreaterThan(GATE.waitLimitMs)
    expect(tablet.settled).toBe(false)
    expect(proMax.settled).toBe(false)
    expect(gate.running()).toEqual(["iphone-se", "android-phone"])

    gate.release(PHONE)
    mac.stop(PHONE)
    await ticks(5)
    expect(tablet).toMatchObject({ settled: true, value: { admitted: true } })
    mac.start(TABLET)

    gate.release(SE)
    mac.stop(SE)
    await ticks(5)
    expect(proMax).toMatchObject({ settled: true, value: { admitted: true } })
    expect(gate.running()).toEqual(["android-tablet", "iphone-17-pro-max"])
  })

  it("ends the run with host_overload when a queued device waits past the limit", async () => {
    const mac = fakeMac({ freeMb: 8000 })
    const gate = gateFor(mac)

    const result = await gate.admit(PHONE, { signal: controller.signal })

    expect(result).toMatchObject({
      admitted: false,
      stopReason: "host_overload",
    })
    expect(result.waitedMs).toBeGreaterThanOrEqual(GATE.waitLimitMs)
    expect(result.message).toMatch(
      /android-phone waited 15 min for 5500 MB of free memory/,
    )
  })

  it("holds a device while the load average is above the limit", async () => {
    const mac = fakeMac({ freeMb: 40000, load1: 8, cores: 12 })
    const gate = gateFor(mac)

    const result = await gate.admit(PHONE, { signal: controller.signal })

    expect(result).toMatchObject({
      admitted: false,
      stopReason: "host_overload",
    })
    expect(result.message).toMatch(/load average/)
  })
})

describe("planCapacity", () => {
  it("plans all three lanes on a Mac with room", () => {
    const sample = { availableMb: 24000, load1: 2, cores: 12 }
    expect(planCapacity({ sample, devices: ALL, gate: GATE })).toMatchObject({
      ok: true,
      lanes: ["ios", "androidPhone", "androidTablet"],
    })
  })

  it("plans one simulator and one emulator on a Mac with less memory", () => {
    const sample = { availableMb: 14000, load1: 2, cores: 12 }
    expect(planCapacity({ sample, devices: ALL, gate: GATE })).toMatchObject({
      ok: true,
      lanes: ["ios", "androidPhone"],
    })
  })

  it("refuses below the floor of one simulator and one emulator", () => {
    const sample = { availableMb: 11000, load1: 2, cores: 12 }
    const plan = planCapacity({ sample, devices: ALL, gate: GATE })
    expect(plan).toMatchObject({ ok: false, reason: "memory" })
    expect(plan.message).toBe(
      "The Mac has too little free memory to run one simulator and one emulator at the same time: they need 8500 MB plus a 4000 MB reserve.",
    )
  })
})

describe("parseVmStat", () => {
  it("counts free, inactive, and speculative pages", () => {
    const text = fs.readFileSync(
      path.join(__dirname, "fixtures", "devices", "vm_stat.txt"),
      "utf8",
    )
    // (184286 + 869200 + 57222) pages * 16384 bytes = 17354.8 MB.
    expect(parseVmStat(text)).toBe(17354)
  })
})
