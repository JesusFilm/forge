/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, afterAll, describe, expect, it, require, setTimeout */
// The probing and journeys phases (KTD5, KTD6): the settings probe runs first
// on each device, and a failed probe stops the run before any other journey
// starts. Devices and Maestro are fakes; the journeys are the real files.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { validateAgainstSchema } = require("../lib/contract")
const { parseFlow } = require("../lib/journeys/flow")
const { PROBE_ID, createJourneyPhases } = require("../lib/journeys/phases")
const { CONFIG_DIR, readJson } = require("../lib/lists")

const DEVICES = readJson(path.join(CONFIG_DIR, "devices.json"))
const SETTINGS = readJson(path.join(CONFIG_DIR, "test-settings.json"))
const SCHEMA = readJson(
  path.join(__dirname, "..", "schema", "summary.schema.json"),
)
const ATTEMPT_SCHEMA = { $defs: SCHEMA.$defs, $ref: "#/$defs/attempt" }
const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function step(type, label, status, error, screen) {
  const condition = screen
    ? { condition: { visible: { idRegex: `screen-${screen}` } } }
    : {}
  return {
    command: { [type]: { label, optional: false, ...condition } },
    metadata: {
      status,
      duration: 50,
      depth: 0,
      ...(error ? { error: { message: error } } : {}),
    },
  }
}

// Writes the commands.json that Maestro would write, and fails `failStep`.
function fakeMaestro(calls, failures) {
  return async ({ deviceRef, flowFile, outputDir }) => {
    const journey = path.basename(flowFile, ".yaml")
    calls.push({ deviceRef, journey })
    const flow = parseFlow(fs.readFileSync(flowFile, "utf8"))
    const failStep = failures[`${deviceRef} ${journey}`] ?? null
    const commands = [step("defineVariablesCommand", undefined, "COMPLETED")]
    for (const top of flow.topLevel) {
      if (top.label === failStep) {
        commands.push(
          step(
            "assertConditionCommand",
            top.label,
            "FAILED",
            "Assertion is false",
          ),
        )
        break
      }
      commands.push(
        step(
          "assertConditionCommand",
          top.label,
          "COMPLETED",
          null,
          top.asserts?.screen,
        ),
      )
    }
    const flowDir = path.join(outputDir, "debug", flow.name)
    fs.mkdirSync(flowDir, { recursive: true })
    fs.writeFileSync(
      path.join(flowDir, "commands.json"),
      JSON.stringify(commands),
    )
    return {
      code: failStep ? 1 : 0,
      timedOut: false,
      stopped: false,
      stdout: "",
      stderr: "",
    }
  }
}

function fakeHandle(ref, events) {
  const ok = async () => ({ ok: true })
  return {
    udid: ref,
    serial: ref,
    restarts: 0,
    boot: async () => {
      events.push(`boot ${ref}`)
      return { ok: true }
    },
    shutdown: async () => {
      events.push(`shutdown ${ref}`)
      return { ok: true }
    },
    install: ok,
    terminate: ok,
    prepareApp: ok,
    probe: ok,
    ensureResponsive: async () => ({ answered: true, restarted: false }),
  }
}

// A host gate with room for two devices at a time: a device waits at the
// gate until another one leaves it.
function twoSlotGate() {
  const held = new Set()
  const waiting = []
  return {
    held,
    admit: (device) =>
      new Promise((resolve) => {
        const tryAdmit = () => {
          if (held.size >= 2) return false
          held.add(device.id)
          resolve({ admitted: true, stopReason: null })
          return true
        }
        if (!tryAdmit()) waiting.push(tryAdmit)
      }),
    release: (device) => {
      held.delete(device.id)
      const index = waiting.findIndex((tryAdmit) => tryAdmit())
      if (index !== -1) waiting.splice(index, 1)
    },
  }
}

function setUp(failures) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-phases-"))
  tempDirs.push(runDir)
  const calls = []
  const events = []
  const stops = []
  const lanes = []
  const abort = new AbortController()
  const phases = createJourneyPhases({
    runMaestro: fakeMaestro(calls, failures),
    runChild: async () => ({ code: 0, stdout: "", stderr: "" }),
    listInventory: async () => ({
      owned: DEVICES.devices.map((device) => ({
        id: device.id,
        udid: device.id,
      })),
    }),
    createSimulator: (device) => fakeHandle(device.udid, events),
    createEmulator: (device) => fakeHandle(device.id, events),
    appEvidence: async () => [],
  })
  const ctx = {
    signal: abort.signal,
    runId: "2026-10-22T03-00-00Z-1a2b",
    runDir,
    env: { PATH: "/usr/bin:/bin" },
    selection: {
      devices: DEVICES.devices,
      journeys: ["cold-launch-home", PROBE_ID],
      platforms: ["ios", "android"],
      scope: "partial",
    },
    settings: SETTINGS,
    devicesConfig: DEVICES,
    artifacts: {
      ios: "/builds/ios/forgewatch.app",
      android: "/builds/app.apk",
    },
    server: { setLaneDevice: (lane, id) => lanes.push(id) },
    admit: async () => ({ admitted: true, stopReason: null }),
    release: () => {},
    stop: (reason) => {
      stops.push(reason)
      abort.abort()
    },
    event: () => {},
  }
  return { phases, ctx, calls, events, stops, lanes }
}

function expectValidAttempts(attempts) {
  for (const attempt of attempts) {
    expect(validateAgainstSchema(ATTEMPT_SCHEMA, attempt)).toEqual([])
  }
}

describe("a failed settings probe", () => {
  it("fails the probing phase, and no journey other than the probe starts", async () => {
    const { phases, ctx, calls } = setUp({
      "android-phone settings-probe": "Home shows",
    })
    const result = await phases.probing(ctx)
    expect(result.passed).toBe(false)
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "SETTINGS_PROBE_FAILED",
        deviceId: "android-phone",
      }),
    ])
    expect(result.findings[0].message).toContain('at "Home shows"')
    expect(calls.every((call) => call.journey === PROBE_ID)).toBe(true)
    expect(calls.map((call) => call.deviceRef).sort()).toEqual([
      "android-phone",
      "android-phone",
      "android-tablet",
      "iphone-se",
    ])
  })

  it("on a later iOS device stops the run before that lane's other journeys start", async () => {
    const { phases, ctx, calls, stops, lanes } = setUp({
      "iphone-17-pro-max settings-probe": "The sign-in card is disabled",
    })
    const probing = await phases.probing(ctx)
    expect(probing.passed).toBe(true)
    const result = await phases.journeys(ctx)
    expect(stops).toEqual(["probe_failed"])
    expect(result.stopReason).toBe("probe_failed")
    expect(result.settingsProbe.passed).toBe(false)
    expect(
      calls.filter(
        (call) =>
          call.deviceRef !== "iphone-se" &&
          call.deviceRef.startsWith("i") &&
          call.journey !== PROBE_ID,
      ),
    ).toEqual([])
    expect(lanes).not.toContain("ipad-pro-13")
    const ipad = result.attempts.filter((a) => a.deviceId === "ipad-pro-13")
    expect(ipad.map((a) => [a.journey, a.status])).toEqual([
      [PROBE_ID, "not_run"],
      ["cold-launch-home", "not_run"],
    ])
    expectValidAttempts(result.attempts)
  })
})

describe("a passing run", () => {
  it("runs the probe first on each device, then its journeys, one iOS device at a time", async () => {
    const { phases, ctx, calls, events } = setUp({})
    expect((await phases.probing(ctx)).passed).toBe(true)
    const result = await phases.journeys(ctx)
    for (const device of DEVICES.devices) {
      expect(
        calls
          .filter((call) => call.deviceRef === device.id)
          .map((c) => c.journey),
      ).toEqual([PROBE_ID, "cold-launch-home"])
    }
    const ios = events.filter((event) => /i(phone|pad)/.test(event))
    expect(ios).toEqual([
      "boot iphone-se",
      "shutdown iphone-se",
      "boot iphone-se",
      "shutdown iphone-se",
      "boot iphone-17-pro-max",
      "shutdown iphone-17-pro-max",
      "boot ipad-pro-13",
      "shutdown ipad-pro-13",
    ])
    expect(result.attempts.every((a) => a.label === "pass")).toBe(true)
    expect(result.screens.notReached).toEqual([])
    expect(result.screens.skippedPlatforms).toContainEqual({
      screen: "tab-explore",
      platform: "android",
      setting: "EXPO_PUBLIC_EXPLORE_ENABLED",
    })
    expectValidAttempts(result.attempts)
  })
})

describe("a host with room for two devices", () => {
  it("ends the probing phase with all three lanes probed, because each probed device leaves the gate", async () => {
    const { phases, ctx, calls } = setUp({})
    const gate = twoSlotGate()
    ctx.admit = gate.admit
    ctx.release = gate.release
    let settled = false
    const probing = phases.probing(ctx).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(settled).toBe(true)
    expect((await probing).passed).toBe(true)
    expect(calls.map((call) => call.deviceRef).sort()).toEqual([
      "android-phone",
      "android-tablet",
      "iphone-se",
    ])
    expect(gate.held.size).toBe(0)
    const result = await phases.journeys(ctx)
    expect(result.attempts.filter((a) => a.status === "passed")).toHaveLength(
      10,
    )
  })
})
