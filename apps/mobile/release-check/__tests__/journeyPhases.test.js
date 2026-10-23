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
const { CONFIG_DIR, JOURNEYS_DIR, readJson } = require("../lib/lists")

const CLEAR_FLOW = "clear-system-alert"

const DEVICES = readJson(path.join(CONFIG_DIR, "devices.json"))
const SETTINGS = readJson(path.join(CONFIG_DIR, "test-settings.json"))
// Pinned so that production values in the committed list do not change what
// these tests expect: Explore stays hidden on both platforms here.
const EXPLORE_HIDDEN_SETTINGS = {
  ...SETTINGS,
  copiedFromProduction: {
    ...SETTINGS.copiedFromProduction,
    EXPO_PUBLIC_EXPLORE_ENABLED: null,
  },
}
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

// The step that fails, from a label (every attempt) or { step, times }.
function failingStep(rule) {
  if (typeof rule === "string") return rule
  if (!rule || rule.times <= 0) return null
  rule.times -= 1
  return rule.step
}

// Writes the commands.json that Maestro would write, and fails `failStep`.
function fakeMaestro(calls, failures, sequence) {
  return async ({ deviceRef, flowFile, outputDir, timeoutMs, signal }) => {
    const journey = path.basename(flowFile, ".yaml")
    const call = { deviceRef, journey, flowFile, outputDir, timeoutMs }
    // Not enumerable: a failure message cannot print an AbortSignal.
    calls.push(Object.defineProperty(call, "signal", { value: signal }))
    sequence.push(`maestro ${deviceRef} ${journey}`)
    const flow = parseFlow(fs.readFileSync(flowFile, "utf8"))
    const failStep = failingStep(failures[`${deviceRef} ${journey}`])
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

function fakeHandle(ref, events, sequence, booted = { ok: true }) {
  const ok = async () => ({ ok: true })
  return {
    udid: ref,
    serial: ref,
    restarts: 0,
    boot: async () => {
      events.push(`boot ${ref}`)
      return booted
    },
    shutdown: async () => {
      events.push(`shutdown ${ref}`)
      return { ok: true }
    },
    install: ok,
    terminate: async () => {
      sequence.push(`terminate ${ref}`)
      return { ok: true }
    },
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

// `options.udid` maps a device id to its simulator UDID (default: the id);
// `options.booted` maps a device ref to the result of its boot.
function setUp(failures, options = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-phases-"))
  tempDirs.push(runDir)
  const calls = []
  const events = []
  const sequence = []
  const children = []
  const recorded = []
  const stops = []
  const lanes = []
  const abort = new AbortController()
  const udid = options.udid ?? ((id) => id)
  const phases = createJourneyPhases({
    ...(options.journeysDir ? { journeysDir: options.journeysDir } : {}),
    runMaestro: fakeMaestro(calls, failures, sequence),
    runChild: async (command, args) => {
      children.push({ command, args })
      return { code: 0, stdout: "", stderr: "" }
    },
    listInventory: async () => ({
      owned: DEVICES.devices.map((device) => ({
        id: device.id,
        udid: udid(device.id),
      })),
    }),
    createSimulator: (device) =>
      fakeHandle(device.udid, events, sequence, options.booted?.[device.udid]),
    createEmulator: (device) =>
      fakeHandle(device.id, events, sequence, options.booted?.[device.id]),
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
    settings: EXPLORE_HIDDEN_SETTINGS,
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
    event: (fields) => recorded.push(fields),
  }
  return {
    phases,
    ctx,
    calls,
    events,
    sequence,
    children,
    recorded,
    stops,
    lanes,
  }
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

  it("returns the probe attempts with its result, so the report keeps them", async () => {
    const { phases, ctx } = setUp({
      "android-phone settings-probe": "Home shows",
    })
    const result = await phases.probing(ctx)
    expectValidAttempts(result.attempts)
    const rows = result.attempts
      .map((a) => [a.deviceId, a.journey, a.attempt, a.status, a.failedStep])
      .sort((a, b) => `${a[0]} ${a[2]}`.localeCompare(`${b[0]} ${b[2]}`))
    expect(rows).toEqual([
      ["android-phone", PROBE_ID, 1, "failed", "Home shows"],
      ["android-phone", PROBE_ID, 2, "failed", "Home shows"],
      ["android-tablet", PROBE_ID, 1, "passed", null],
      ["iphone-se", PROBE_ID, 1, "passed", null],
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
          call.journey !== PROBE_ID &&
          call.journey !== CLEAR_FLOW,
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

describe("a device that does not start", () => {
  const IN_USE =
    "emulator-5640 is already in use, so the runner does not start forge_rc_phone on it"

  it("does not stop an emulator whose serial another session holds", async () => {
    const { phases, ctx, events, recorded } = setUp(
      {},
      {
        booted: {
          "android-phone": {
            ok: false,
            refused: true,
            class: null,
            error: IN_USE,
          },
        },
      },
    )

    await phases.probing(ctx)

    expect(events.filter((event) => event.endsWith("android-phone"))).toEqual([
      "boot android-phone",
    ])
    expect(recorded).toContainEqual({
      type: "device_start_failed",
      deviceId: "android-phone",
      error: IN_USE,
    })
  })

  it("still stops a device whose boot failed after it started", async () => {
    const { phases, ctx, events } = setUp(
      {},
      {
        booted: {
          "android-phone": { ok: false, class: null, error: "no boot" },
        },
      },
    )

    await phases.probing(ctx)

    expect(events.filter((event) => event.endsWith("android-phone"))).toEqual([
      "boot android-phone",
      "shutdown android-phone",
    ])
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

// KTD14: an iOS link prompt that a failed attempt leaves open stays up across
// the app reinstall, so the clean-up closes it with its own Maestro flow.
describe("the clean-up after a failed attempt", () => {
  const clearCalls = (calls) => calls.filter((c) => c.journey === CLEAR_FLOW)

  async function runBoth(phases, ctx) {
    await phases.probing(ctx)
    return phases.journeys(ctx)
  }

  it("on iOS runs the clear-alert flow once on the simulator's UDID, after the app stops, and the flow does not start the app", async () => {
    const { phases, ctx, calls, sequence } = setUp(
      { "udid-iphone-se cold-launch-home": { step: "Home shows", times: 1 } },
      { udid: (id) => `udid-${id}` },
    )
    const result = await runBoth(phases, ctx)
    const attemptDir = path.join(
      ctx.runDir,
      "attempts",
      "cold-launch-home",
      "iphone-se",
      "1",
    )
    const clears = clearCalls(calls)
    expect(clears).toEqual([
      expect.objectContaining({
        deviceRef: "udid-iphone-se",
        flowFile: path.join(
          ctx.runDir,
          "journeys",
          "_shared",
          "clear-system-alert.yaml",
        ),
      }),
    ])
    expect(clears[0].signal).toBe(ctx.signal)
    expect(clears[0].timeoutMs).toBeLessThanOrEqual(60_000)
    expect(clears[0].outputDir.startsWith(attemptDir + path.sep)).toBe(true)
    const at = sequence.indexOf("maestro udid-iphone-se clear-system-alert")
    expect(sequence[at - 1]).toBe("terminate udid-iphone-se")
    const flow = parseFlow(fs.readFileSync(clears[0].flowFile, "utf8"))
    const commands = flow.steps.map((s) => s.command)
    expect(commands).not.toContain("launchApp")
    expect(commands).not.toContain("openLink")
    expect(flow.steps).toContainEqual(
      expect.objectContaining({
        command: "tapOn",
        label: expect.any(String),
        args: expect.objectContaining({ text: "Cancel", optional: true }),
      }),
    )
    const journey = result.attempts.filter(
      (a) => a.deviceId === "iphone-se" && a.journey === "cold-launch-home",
    )
    expect(journey.map((a) => [a.attempt, a.status, a.label])).toEqual([
      [1, "failed", "flaky"],
      [2, "passed", "flaky"],
    ])
  })

  it("on Android does not run the flow, and still closes the system dialogs", async () => {
    const { phases, ctx, calls, children } = setUp({
      "android-phone cold-launch-home": "Home shows",
    })
    await runBoth(phases, ctx)
    expect(clearCalls(calls)).toEqual([])
    const closes = children.filter((child) =>
      child.args.includes("android.intent.action.CLOSE_SYSTEM_DIALOGS"),
    )
    expect(closes.map((child) => child.args.slice(0, 2))).toEqual([
      ["-s", "android-phone"],
      ["-s", "android-phone"],
    ])
  })

  it("does not run after a passing iOS attempt", async () => {
    const { phases, ctx, calls } = setUp({})
    await runBoth(phases, ctx)
    expect(calls.filter((c) => /^i(phone|pad)/.test(c.deviceRef))).toHaveLength(
      6,
    )
    expect(clearCalls(calls)).toEqual([])
  })

  it("skips the flow with an event when the run's journeys do not have it", async () => {
    const journeysDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "release-check-old-journeys-"),
    )
    tempDirs.push(journeysDir)
    for (const name of ["settings-probe.yaml", "cold-launch-home.yaml"]) {
      fs.copyFileSync(
        path.join(JOURNEYS_DIR, name),
        path.join(journeysDir, name),
      )
    }
    const { phases, ctx, calls, recorded } = setUp(
      { "iphone-se cold-launch-home": "Home shows" },
      { journeysDir },
    )
    const result = await runBoth(phases, ctx)
    expect(clearCalls(calls)).toEqual([])
    const skipped = recorded.filter(
      (event) => event.type === "system_alert_clear_skipped",
    )
    expect(skipped).toEqual([
      expect.objectContaining({ deviceId: "iphone-se" }),
      expect.objectContaining({ deviceId: "iphone-se" }),
    ])
    const journey = result.attempts.filter(
      (a) => a.deviceId === "iphone-se" && a.journey === "cold-launch-home",
    )
    expect(journey.map((a) => a.status)).toEqual(["failed", "failed"])
  })
})
