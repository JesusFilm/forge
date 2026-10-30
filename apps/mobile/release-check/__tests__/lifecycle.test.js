/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require, setTimeout */
// The run lifecycle (KTD13, R38): one end path for every started run, a
// refusal on the stale lock of a killed run, ports held at consent, a
// detached child, phase time limits, and the status, stop, and recover modes.
const childProcess = require("node:child_process")
const crypto = require("node:crypto")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

const { parseArgs } = require("../lib/contract")
const { stopOwnedDevices } = require("../lib/devices/inventory")
const {
  childArgs,
  createDeps,
  recoverCommand,
  runCommand,
  setupMode,
  spawnDetached,
  statusCommand,
  stopCommand,
} = require("../lib/lifecycle")
const { lockPath } = require("../lib/lock")
const { readJson } = require("../lib/lists")
const { planCommand } = require("../lib/plan")
const { buildSummary } = require("../lib/report/summary")
const { checkLog } = require("../lib/server/logCheck")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const GB = 1024 ** 3
const RUN_ID = "2026-10-22T02-10-00Z-1a2b"
const DEVICES = readJson(path.join(__dirname, "..", "config", "devices.json"))
const LIB = path.join(__dirname, "..", "lib")

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-life-"))
  tempDirs.push(dir)
  return dir
}

function endedPid() {
  return childProcess.spawnSync("/usr/bin/true").pid
}

function waitFor(check, limitMs = 10_000) {
  const end = Date.now() + limitMs
  return new Promise((resolve) => {
    const poll = () => {
      if (check()) resolve(true)
      else if (Date.now() > end) resolve(false)
      else setTimeout(poll, 25)
    }
    poll()
  })
}

function untilAborted(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener("abort", resolve, { once: true })
  })
}

function readySetup() {
  return {
    ready: true,
    check: true,
    problems: [],
    notes: [],
    devices: DEVICES.devices.map((device) => ({ id: device.id, status: "ok" })),
    downloads: [],
    actions: [],
    observed: { hostTimezone: "Etc/UTC", xcode: "26.5" },
  }
}

function attempt(journey, deviceId, fields = {}) {
  return {
    journey,
    deviceId,
    attempt: 1,
    status: "passed",
    label: "pass",
    class: null,
    failedStep: null,
    error: null,
    screenshot: null,
    stepTimes: [],
    restart: false,
    notRunSteps: [],
    knownBugTicket: null,
    screensReached: [],
    ...fields,
  }
}

function passingJourneys({ selection }) {
  return {
    attempts: selection.devices.flatMap((device) =>
      selection.journeys.map((journey) => attempt(journey, device.id)),
    ),
    screens: { gaps: [], notReached: [], skippedPlatforms: [] },
  }
}

function stubDeps(home, overrides = {}) {
  const calls = { build: [], server: [], stopOwned: [], stopChildren: 0 }
  const out = []
  const err = []
  const signals = new EventEmitter()
  const server = {
    bind: async () => calls.server.push("bind"),
    startAnswering: () => calls.server.push("startAnswering"),
    setLaneDevice: () => {},
    setSpeedMode: () => {},
    stats: () => ({ routes: {}, rateLimitRefusals: [] }),
    close: async () => calls.server.push("close"),
  }
  const groups = {
    git: {
      head: async () => COMMIT,
      dirty: async () => [],
      objectId: async (commit, rel) => `${commit}:${rel}`,
      show: async () => "type Query { ok: Boolean }",
    },
    setup: { check: async () => readySetup(), apply: async () => readySetup() },
    devices: {
      list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
      stopOwned: async (inventory) => {
        calls.stopOwned.push(inventory)
        return []
      },
      runningForeign: () => [],
    },
    host: {
      sample: async () => ({ availableMb: 40000, load1: 1, cores: 12 }),
      diskFree: () => ({ dir: home, freeBytes: 200 * GB }),
    },
    admin: {
      preflight: async () => ({ url: "u", reachable: true, detail: null }),
    },
    gate: {
      planCapacity: () => ({
        ok: true,
        lanes: ["ios"],
        reason: null,
        message: null,
      }),
      create: () => ({
        admit: async () => ({ admitted: true }),
        release: () => {},
      }),
    },
    server: {
      create: () => {
        calls.server.push("create")
        return server
      },
    },
    build: {
      buildTestApps: async (options) => {
        calls.build.push(options)
        fs.mkdirSync(options.buildDir, { recursive: true })
        return {
          ok: true,
          platforms: {
            ios: { artifact: "a.app" },
            android: { artifact: "a.apk" },
          },
        }
      },
      checkArtifact: async () => ({ findings: [] }),
    },
    phases: {
      probing: async () => ({ passed: true, findings: [] }),
      journeys: async (ctx) => passingJourneys(ctx),
      speed: async () => ({ devices: [] }),
    },
  }
  const merged = {
    home,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    stdin: { isTTY: false },
    signals,
    heartbeatMs: 60_000,
    graceMs: 200,
    pollMs: 25,
    journeyIds: () => ["cold-launch-home"],
    buildInputs: () => ["apps/mobile"],
    logCheck: () => ({
      passed: true,
      findings: [],
      perDevice: {},
      routes: {},
      rateLimitRefusals: [],
    }),
    stopChildren: async () => {
      calls.stopChildren += 1
    },
    caffeinate: async () => {},
    macTimeZone: () => "Etc/UTC",
    ...overrides,
  }
  for (const [group, value] of Object.entries(groups)) {
    merged[group] = { ...value, ...overrides[group] }
  }
  return { deps: createDeps(merged), calls, out, err, signals }
}

function runDirs(home) {
  const runs = path.join(home, "runs")
  return fs.existsSync(runs) ? fs.readdirSync(runs) : []
}

function onlySummary(home) {
  const names = runDirs(home)
  expect(names).toHaveLength(1)
  return readJson(path.join(home, "runs", names[0], "summary.json"))
}

describe("an abort during the journeys (AE12)", () => {
  it("writes summary.json with stopReason aborted and stops only its own devices and server", async () => {
    const home = tempHome()
    const inventory = {
      owned: [
        {
          platform: "ios",
          id: "iphone-se",
          name: "Forge RC iPhone SE",
          udid: "OWNED-SE",
          running: true,
        },
        {
          platform: "ios",
          id: "ipad-pro-13",
          name: "Forge RC iPad Pro 13",
          udid: "OWNED-IPAD",
          running: false,
        },
      ],
      foreign: [
        {
          platform: "ios",
          name: "iPhone 17",
          udid: "OTHER-SIM",
          running: true,
        },
        {
          platform: "android",
          avd: "Pixel_9a",
          serial: "emulator-5554",
          pid: 1,
          running: true,
        },
      ],
      missing: [],
      errors: [],
    }
    const deviceCommands = []
    const stub = stubDeps(home, {
      devices: {
        list: async () => inventory,
        stopOwned: (current) =>
          stopOwnedDevices(current, {
            env: { PATH: "/usr/bin:/bin" },
            runChild: async (command, args) => {
              deviceCommands.push([command, ...args])
              return {
                code: 0,
                timedOut: false,
                stopped: false,
                stdout: "",
                stderr: "",
              }
            },
          }),
      },
      phases: {
        journeys: async (ctx) => {
          stub.signals.emit("SIGTERM")
          await untilAborted(ctx.signal)
          return {
            attempts: [
              attempt("cold-launch-home", "iphone-se", {
                status: "not_run",
                label: "not_run",
              }),
            ],
          }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), stub.deps)).toBe(1)

    const summary = onlySummary(home)
    expect(summary).toMatchObject({
      stopReason: "aborted",
      result: "fail",
      exitCode: 1,
      completedPhases: ["building", "checking", "probing"],
    })
    expect(summary.journeys.map((entry) => entry.label)).toEqual(["not_run"])
    expect(deviceCommands).toEqual([
      ["/usr/bin/xcrun", "simctl", "shutdown", "OWNED-SE"],
    ])
    expect(stub.calls.server.filter((call) => call === "close")).toHaveLength(1)
    expect(stub.calls.stopChildren).toBe(1)
    expect(stub.signals.listenerCount("SIGTERM")).toBe(0)
    expect(fs.existsSync(lockPath(home))).toBe(false)
    const dir = path.join(home, "runs", runDirs(home)[0])
    expect(fs.existsSync(path.join(dir, "report.html"))).toBe(true)
    expect(readJson(path.join(dir, "status.json"))).toMatchObject({
      phase: "ended",
      stopReason: "aborted",
      exitCode: 1,
    })
  })
})

describe("a phase time limit", () => {
  it("ends the run with stopReason timeout when the journeys outlast their limit", async () => {
    const home = tempHome()
    let phaseSignal = null
    const { deps } = stubDeps(home, {
      limits: { journeys: 100 },
      phases: {
        journeys: async (ctx) => {
          phaseSignal = ctx.signal
          await untilAborted(ctx.signal)
          return { attempts: [] }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    expect(onlySummary(home)).toMatchObject({
      stopReason: "timeout",
      completedPhases: ["building", "checking", "probing"],
    })
    expect(phaseSignal.aborted).toBe(true)
  })
})

const PROBE_FINDING = {
  code: "SETTINGS_PROBE_FAILED",
  message:
    "The settings probe failed on iphone-17-pro-max at Home body is live.",
  setting: null,
  file: "apps/mobile/release-check/journeys/settings-probe.yaml",
  deviceId: "iphone-17-pro-max",
}

function failedProbe(deviceId) {
  return attempt("settings-probe", deviceId, {
    status: "failed",
    label: "new",
    class: "selector_not_found",
    failedStep: "Home body is live",
    error: "Element not found: home-body-live",
  })
}

function serverWith(stats) {
  return {
    bind: async () => {},
    startAnswering: () => {},
    setLaneDevice: () => {},
    setSpeedMode: () => {},
    stats,
    close: async () => {},
  }
}

describe("the probing phase's attempts", () => {
  it("reach summary.json when a probe fails, with the probe's failure", async () => {
    const home = tempHome()
    const finding = { ...PROBE_FINDING, deviceId: "iphone-se" }
    const { deps } = stubDeps(home, {
      phases: {
        probing: async () => ({
          passed: false,
          findings: [finding],
          attempts: [failedProbe("iphone-se")],
        }),
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary.stopReason).toBe("probe_failed")
    expect(summary.journeys).toEqual([
      {
        journey: "settings-probe",
        deviceId: "iphone-se",
        label: "new",
        attempts: [failedProbe("iphone-se")],
      },
    ])
    expect(summary.checks.settingsProbe).toEqual({
      passed: false,
      findings: [finding],
    })
  })

  it("reach summary.json when the run stops during probing", async () => {
    const home = tempHome()
    const notRun = attempt("settings-probe", "android-phone", {
      status: "not_run",
      label: "not_run",
      error: "The run stopped before this journey.",
    })
    const stub = stubDeps(home, {
      phases: {
        probing: async (ctx) => {
          stub.signals.emit("SIGTERM")
          await untilAborted(ctx.signal)
          return { passed: true, findings: [], attempts: [notRun] }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), stub.deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary).toMatchObject({
      stopReason: "aborted",
      completedPhases: ["building", "checking"],
    })
    expect(summary.journeys.map((entry) => entry.attempts)).toEqual([[notRun]])
  })

  it("come first, once, when the journeys phase repeats them", async () => {
    const home = tempHome()
    const probe = attempt("settings-probe", "iphone-se")
    const journey = attempt("cold-launch-home", "iphone-se")
    const inputs = []
    const { deps } = stubDeps(home, {
      phases: {
        probing: async () => ({
          passed: true,
          findings: [],
          attempts: [probe],
        }),
        journeys: async () => ({
          attempts: [journey, { ...probe }],
          screens: { gaps: [], notReached: [], skippedPlatforms: [] },
        }),
      },
      report: {
        buildSummary: (input) => {
          inputs.push(input)
          return buildSummary(input)
        },
      },
    })
    await runCommand(parseArgs(["run", "--yes"]), deps)
    expect(inputs.map((input) => input.attempts)).toEqual([[probe, journey]])
  })
})

describe("a settings probe inside the journeys phase", () => {
  it("fails checks.settingsProbe with that device's finding", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home, {
      phases: {
        journeys: async (ctx) => {
          ctx.stop("probe_failed", "iphone-17-pro-max")
          return {
            attempts: [failedProbe("iphone-17-pro-max")],
            stopReason: "probe_failed",
            settingsProbe: { passed: false, findings: [PROBE_FINDING] },
          }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary.stopReason).toBe("probe_failed")
    expect(summary.checks.settingsProbe).toEqual({
      passed: false,
      findings: [PROBE_FINDING],
    })
  })
})

function forwardedLine(deviceId, query) {
  const body = JSON.stringify({ query })
  return JSON.stringify({
    ts: "2026-10-22T03:00:00.000Z",
    port: 38211,
    lane: "ios",
    deviceId,
    method: "POST",
    path: "/api/graphql",
    route: "forwarded",
    forwardedBody: body,
    forwardedSha256: crypto.createHash("sha256").update(body).digest("hex"),
    status: 200,
  })
}

function appendServerLog(runDir, lines) {
  fs.appendFileSync(
    path.join(runDir, "server-log.jsonl"),
    lines.map((line) => `${line}\n`).join(""),
  )
}

describe("the log check after an early stop", () => {
  it("runs after a probe_failed stop and reports a forwarded write", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home, {
      logCheck: checkLog,
      phases: {
        probing: async (ctx) => {
          appendServerLog(ctx.runDir, [
            forwardedLine("iphone-se", "mutation Probe { releaseCheckWrite }"),
          ])
          return {
            passed: false,
            findings: [],
            attempts: [
              failedProbe("iphone-se"),
              attempt("settings-probe", "android-phone", {
                status: "not_run",
                label: "not_run",
                error: "The run stopped before this journey.",
              }),
            ],
          }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary.stopReason).toBe("probe_failed")
    expect(summary.completedPhases).not.toContain("logcheck")
    expect(summary.checks.log).toMatchObject({
      passed: false,
      perDevice: { "iphone-se": 1 },
    })
    expect(summary.checks.log.findings.map((item) => item.code)).toEqual([
      "FORWARDED_MUTATION",
      "FORWARDED_NOT_READ_ONLY",
    ])
  })

  it("runs after a timeout stop and expects traffic from each started device", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home, {
      logCheck: checkLog,
      limits: { journeys: 100 },
      phases: {
        probing: async () => ({
          passed: true,
          findings: [],
          attempts: [
            attempt("settings-probe", "iphone-se"),
            attempt("settings-probe", "ipad-pro-13"),
          ],
        }),
        journeys: async (ctx) => {
          appendServerLog(ctx.runDir, [
            forwardedLine("iphone-se", "query Read { watchSetting { id } }"),
          ])
          await untilAborted(ctx.signal)
          return { attempts: [] }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary.stopReason).toBe("timeout")
    expect(summary.checks.log).toMatchObject({
      passed: false,
      perDevice: { "iphone-se": 1 },
      findings: [
        expect.objectContaining({
          code: "DEVICE_NO_TRAFFIC",
          deviceId: "ipad-pro-13",
        }),
      ],
    })
    expect(summary.checks.log.findings).toHaveLength(1)
  })

  it("fails the log check when the server could not complete a request", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home, {
      server: {
        create: () =>
          serverWith(() => ({
            routes: {},
            rateLimitRefusals: [],
            handlerFailures: 2,
          })),
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary).toMatchObject({ stopReason: "completed", result: "fail" })
    expect(summary.completedPhases).toContain("logcheck")
    expect(summary.checks.log.passed).toBe(false)
    expect(summary.checks.log.findings).toEqual([
      expect.objectContaining({
        code: "SERVER_HANDLER_FAILED",
        message: expect.stringContaining("2 requests"),
      }),
    ])
  })
})

describe("admin rate-limit refusals in the speed pass (R36)", () => {
  // Every clock read moves one second, so each phase has its own window.
  function steppedClock() {
    let ms = Date.parse("2026-10-22T03:00:00.000Z")
    return () => (ms += 1000)
  }

  function journeyRefusal(ts) {
    return {
      ts,
      field: "video",
      deviceId: "iphone-se",
      journey: "cold-launch-home",
      attempt: 1,
    }
  }

  it("adds the log check's refusals from the speed window", async () => {
    const home = tempHome()
    const now = steppedClock()
    const times = {}
    const { deps } = stubDeps(home, {
      now,
      phases: {
        journeys: async (ctx) => {
          times.journey = new Date(now()).toISOString()
          return {
            ...passingJourneys(ctx),
            rateLimitRefusals: [journeyRefusal(times.journey)],
          }
        },
        speed: async () => {
          times.speed = new Date(now()).toISOString()
          return { devices: [] }
        },
      },
      logCheck: () => ({
        passed: true,
        findings: [],
        perDevice: {},
        routes: {},
        rateLimitRefusals: [
          { ts: times.journey, field: "video", deviceId: "iphone-se" },
          { ts: times.speed, field: "videos", deviceId: "android-phone" },
        ],
      }),
    })
    await runCommand(parseArgs(["run", "--yes"]), deps)
    expect(onlySummary(home).server.rateLimitRefusals).toEqual([
      { ...journeyRefusal(times.journey), causedFailure: null },
      {
        ts: times.speed,
        field: "videos",
        deviceId: "android-phone",
        journey: null,
        attempt: null,
        causedFailure: null,
      },
    ])
  })

  it("takes them from the server when the run stops before the log check", async () => {
    const home = tempHome()
    const now = steppedClock()
    const times = {}
    const stub = stubDeps(home, {
      now,
      server: {
        create: () =>
          serverWith(() => ({
            routes: {},
            rateLimitRefusals: [
              { ts: times.journey, field: "video", deviceId: "iphone-se" },
              { ts: times.speed, field: "videos", deviceId: "ipad-pro-13" },
            ],
          })),
      },
      phases: {
        journeys: async (ctx) => {
          times.journey = new Date(now()).toISOString()
          return {
            ...passingJourneys(ctx),
            rateLimitRefusals: [journeyRefusal(times.journey)],
          }
        },
        speed: async (ctx) => {
          times.speed = new Date(now()).toISOString()
          stub.signals.emit("SIGTERM")
          await untilAborted(ctx.signal)
          return { devices: [] }
        },
      },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), stub.deps)).toBe(1)
    const summary = onlySummary(home)
    expect(summary.completedPhases).not.toContain("logcheck")
    expect(summary.server.rateLimitRefusals.map((item) => item.ts)).toEqual([
      times.journey,
      times.speed,
    ])
  })
})

describe("proposed list changes (KTD16)", () => {
  async function proposedActions(journeys) {
    const home = tempHome()
    const { deps } = stubDeps(home, { phases: { journeys } })
    await runCommand(parseArgs(["run", "--yes"]), deps)
    return onlySummary(home).proposedActions
  }

  const NO_GAPS = { gaps: [], notReached: [], skippedPlatforms: [] }

  it("proposes a Known-Bug entry for each journey on a device labelled new", async () => {
    const newFailure = {
      status: "failed",
      label: "new",
      class: "app_crashed",
      failedStep: "The video plays",
      error: "The app crashed.",
    }
    const flaky = { label: "flaky" }
    const known = { label: "known", knownBugTicket: "FORGE-1" }
    const actions = await proposedActions(async () => ({
      attempts: [
        attempt("open-video-play", "ipad-pro-13", { ...newFailure, ...known }),
        attempt("open-video-play", "ipad-pro-13", {
          ...newFailure,
          ...known,
          attempt: 2,
        }),
        attempt("open-video-play", "iphone-se", newFailure),
        attempt("open-video-play", "iphone-se", { ...newFailure, attempt: 2 }),
        attempt("open-video-play", "android-phone", {
          ...newFailure,
          ...flaky,
        }),
        attempt("open-video-play", "android-phone", { attempt: 2, ...flaky }),
        attempt("cold-launch-home", "iphone-se"),
      ],
      screens: NO_GAPS,
    }))
    expect(actions).toEqual([
      {
        type: "add_known_bug",
        reason: expect.any(String),
        journey: "open-video-play",
        devices: ["iphone-se"],
        step: "The video plays",
        check: "app_crashed",
        ticket: null,
      },
    ])
  })

  it("proposes the removal of each stale Known-Bug entry", async () => {
    const stale = {
      journey: "cold-launch-home",
      devices: ["iphone-se", "android-phone"],
      step: "Home content shows",
      check: "assertion_failed",
      ticket: "FORGE-2050",
    }
    const actions = await proposedActions(async (ctx) => ({
      ...passingJourneys(ctx),
      staleKnownBugs: [stale],
    }))
    expect(actions).toEqual([
      { type: "remove_known_bug", reason: expect.any(String), ...stale },
    ])
  })

  it("proposes one saved search answer for each search that had none", async () => {
    const peace = { query: "peace", limit: 20, offset: 0, language: "english" }
    const line = (deviceId, route, search) =>
      JSON.stringify({
        ts: "2026-10-22T03:00:00.000Z",
        port: 38211,
        lane: "ios",
        deviceId,
        method: "POST",
        path: "/api/graphql",
        route,
        opType: "query",
        opName: "WatchSearch",
        status: 200,
        rateLimit: null,
        search,
      })
    const actions = await proposedActions(async (ctx) => {
      fs.writeFileSync(
        path.join(ctx.runDir, "server-log.jsonl"),
        [
          line("iphone-se", "missing-search-answer", peace),
          line("android-phone", "missing-search-answer", { ...peace }),
          line("iphone-se", "saved-answer", { ...peace, query: "jesus" }),
          line("iphone-se", "missing-search-answer", { ...peace, offset: 20 }),
        ].join("\n"),
      )
      return passingJourneys(ctx)
    })
    expect(actions).toEqual([
      {
        type: "record_search_answer",
        reason: expect.any(String),
        search: peace,
      },
      {
        type: "record_search_answer",
        reason: expect.any(String),
        search: { ...peace, offset: 20 },
      },
    ])
  })

  it("proposes a journey for each screen gap", async () => {
    const gaps = [
      { screen: "tab-explore", platform: "ios" },
      { screen: "reader-settings", platform: "android" },
    ]
    const actions = await proposedActions(async (ctx) => ({
      ...passingJourneys(ctx),
      screens: { ...NO_GAPS, gaps },
    }))
    expect(actions).toEqual(
      gaps.map((gap) => ({
        type: "write_journey",
        reason: expect.any(String),
        ...gap,
      })),
    )
  })
})

describe("a stale lock", () => {
  function writeDeadLock(home, mode, runId) {
    const dead = {
      pid: endedPid(),
      processStart: "Thu Oct 22 01:00:00 2026",
      mode,
      runId,
    }
    fs.writeFileSync(lockPath(home), JSON.stringify(dead))
    return dead
  }

  it("of a killed run blocks the next run until recover removes it", async () => {
    const home = tempHome()
    const dead = writeDeadLock(home, "run", "2026-10-22T01-00-00Z-dead")
    const { deps, out, err, calls } = stubDeps(home)

    expect(await planCommand(parseArgs(["plan", "--json"]), deps)).toBe(0)
    const shown = JSON.parse(out.at(-1))
    expect(shown.lock).toMatchObject({
      state: "stale",
      reason: "pid_ended",
      pid: dead.pid,
    })
    expect(shown.refusals.map((item) => item.code)).toEqual(["STALE_RUN_LOCK"])
    expect(shown.refusals[0].message).toContain(
      "Run `node apps/mobile/release-check/cli.mjs recover` first.",
    )

    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(2)
    expect(err.join("\n")).toContain("STALE_RUN_LOCK")
    expect(calls.build).toEqual([])
    expect(readJson(lockPath(home))).toEqual(dead)

    expect(await recoverCommand(parseArgs(["recover"]), deps)).toBe(0)
    expect(calls.stopOwned).toHaveLength(1)
    expect(fs.existsSync(lockPath(home))).toBe(false)

    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(0)
    expect(onlySummary(home).result).toBe("pass")
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })

  it("of a killed run makes setup refuse and keep it, so recover finds the orphan", async () => {
    const home = tempHome()
    const dead = writeDeadLock(home, "run", "2026-10-22T01-00-00Z-dead")
    const setups = []
    const { deps, out, err, calls } = stubDeps(home, {
      setupCommand: async (command) => {
        setups.push(command.flags)
        return 0
      },
    })

    expect(await setupMode(parseArgs(["setup"]), deps)).toBe(2)
    expect(err.join("\n")).toContain(
      "release-check refused: setup did not start.\n- STALE_RUN_LOCK: ",
    )
    expect(setups).toEqual([])
    expect(readJson(lockPath(home))).toEqual(dead)

    expect(await setupMode(parseArgs(["setup", "--check"]), deps)).toBe(0)
    expect(setups).toEqual([{ check: true }])
    expect(readJson(lockPath(home))).toEqual(dead)

    expect(await recoverCommand(parseArgs(["recover"]), deps)).toBe(0)
    expect(calls.stopOwned).toHaveLength(1)
    expect(out.join("\n")).toContain(`Run ${dead.runId} left no run.json`)
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })

  it("of a killed record-search makes recover stop the runner's devices", async () => {
    const home = tempHome()
    const dead = writeDeadLock(
      home,
      "record-search",
      "2026-10-22T01-00-00Z-rec",
    )
    const { deps, out, calls } = stubDeps(home)

    expect(await recoverCommand(parseArgs(["recover"]), deps)).toBe(0)

    expect(calls.stopOwned).toHaveLength(1)
    expect(out).toEqual([
      `release-check recover: removed the stale record-search lock of pid ${dead.pid} and stopped the runner's devices.`,
    ])
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })

  it("of another mode shows as stale in plan and does not block the next run", async () => {
    const home = tempHome()
    const dead = writeDeadLock(home, "setup", null)
    const { deps, out } = stubDeps(home)

    expect(await planCommand(parseArgs(["plan", "--json"]), deps)).toBe(0)
    const shown = JSON.parse(out.at(-1))
    expect(shown.lock).toMatchObject({ state: "stale", pid: dead.pid })
    expect(shown.refusals).toEqual([])
    expect(shown.runCommand).toBe(
      `node apps/mobile/release-check/cli.mjs run --yes --expect-commit ${COMMIT}`,
    )

    expect(await runCommand(parseArgs(["run", "--yes"]), deps)).toBe(0)
    expect(onlySummary(home).result).toBe("pass")
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })
})

function listen(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen({ port, host }, () => resolve(server))
  })
}

describe("held ports", () => {
  it("refuses before any build call when a listener holds a lane port", async () => {
    const home = tempHome()
    const holder = await listen(0, "127.0.0.1")
    const port = holder.address().port
    try {
      const real = createDeps({})
      const stub = stubDeps(home, {
        lanes: () => [{ lane: "ios", port }],
        server: { create: real.server.create },
      })
      expect(await runCommand(parseArgs(["run", "--yes"]), stub.deps)).toBe(2)
      expect(stub.err.join("\n")).toContain("PORT_TAKEN")
      expect(stub.err.join("\n")).toContain(String(port))
      expect(stub.calls.build).toEqual([])
      expect(fs.existsSync(lockPath(home))).toBe(false)
      expect(runDirs(home)).toEqual([])
    } finally {
      await new Promise((resolve) => holder.close(resolve))
    }

    // The same run with free ports binds them, builds, and closes them.
    const stub = stubDeps(home, {
      lanes: () => [{ lane: "ios", port: 0 }],
      server: { create: createDeps({}).server.create },
    })
    expect(await runCommand(parseArgs(["run", "--yes"]), stub.deps)).toBe(0)
    expect(stub.calls.build).toHaveLength(1)
  })
})

const CHILD_SCRIPT = `
const fs = require("node:fs")
const path = require("node:path")
const argv = process.argv.slice(2)
const runId = argv[argv.indexOf("--run-id") + 1]
const runDir = path.join(process.env.RC_HOME, "runs", runId)
fs.writeFileSync(path.join(runDir, "child.pid"), String(process.pid))
console.log("child argv " + JSON.stringify(argv))
setTimeout(() => {
  fs.writeFileSync(path.join(runDir, "summary.json"), "{}")
}, 400)
`

describe("run --detach", () => {
  it("returns a run id while the child runs, and the child ends with summary.json", async () => {
    const home = tempHome()
    const script = path.join(home, "child.js")
    fs.writeFileSync(script, CHILD_SCRIPT)
    const { deps, out } = stubDeps(home, {
      cliPath: script,
      env: { PATH: process.env.PATH, RC_HOME: home },
      spawnDetached,
    })
    const args = ["run", "--yes", "--detach", "--platform", "ios"]
    expect(await runCommand(parseArgs(args), deps)).toBe(0)

    const printed = JSON.parse(out.at(-1))
    expect(printed.runDir).toBe(path.join(home, "runs", printed.runId))
    const summary = path.join(printed.runDir, "summary.json")
    const pidFile = path.join(printed.runDir, "child.pid")
    expect(fs.existsSync(summary)).toBe(false)
    expect(await waitFor(() => fs.existsSync(pidFile))).toBe(true)
    expect(() =>
      process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0),
    ).not.toThrow()
    expect(await waitFor(() => fs.existsSync(summary))).toBe(true)

    const log = fs.readFileSync(path.join(printed.runDir, "runner.log"), "utf8")
    expect(JSON.parse(log.replace("child argv ", ""))).toEqual([
      "run",
      "--yes",
      "--expect-commit",
      COMMIT,
      "--run-id",
      printed.runId,
      "--platform",
      "ios",
    ])
  })

  it("gives the child the same run flags, with no --detach", () => {
    const flags = parseArgs([
      "run",
      "--detach",
      "--allow-setup",
      "--journey",
      "a,b",
      "--device",
      "iphone-se",
      "--skip-speed-pass",
      "--reuse-build",
    ]).flags
    expect(
      parseArgs(childArgs(flags, { runId: RUN_ID, commit: COMMIT })),
    ).toEqual({
      ok: true,
      mode: "run",
      subcommand: null,
      positionals: [],
      flags: {
        yes: true,
        "expect-commit": COMMIT,
        "run-id": RUN_ID,
        "allow-setup": true,
        journey: ["a", "b"],
        device: ["iphone-se"],
        "skip-speed-pass": true,
        "reuse-build": true,
      },
    })
  })

  it("lets the child write its report into the folder that the launcher named", async () => {
    const home = tempHome()
    const runDir = path.join(home, "runs", RUN_ID)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, "runner.log"), "")
    const { deps } = stubDeps(home)
    expect(
      await runCommand(parseArgs(["run", "--yes", "--run-id", RUN_ID]), deps),
    ).toBe(0)
    expect(runDirs(home)).toEqual([RUN_ID])
    expect(readJson(path.join(runDir, "summary.json")).runId).toBe(RUN_ID)
  })

  it("writes a child's refusal into status.json, with no report", async () => {
    const home = tempHome()
    const runDir = path.join(home, "runs", RUN_ID)
    fs.mkdirSync(runDir, { recursive: true })
    const { deps } = stubDeps(home, {
      git: { dirty: async () => ["apps/mobile/app.json"] },
    })
    expect(
      await runCommand(parseArgs(["run", "--yes", "--run-id", RUN_ID]), deps),
    ).toBe(2)
    expect(readJson(path.join(runDir, "status.json"))).toMatchObject({
      phase: "refused",
      refusals: [{ code: "DIRTY_BUILD_INPUTS" }],
    })
    expect(fs.existsSync(path.join(runDir, "summary.json"))).toBe(false)
  })
})

describe("status", () => {
  it("shows the finished run's result and the paths of its report", async () => {
    const home = tempHome()
    const { deps, out } = stubDeps(home)
    await runCommand(parseArgs(["run", "--yes"]), deps)
    const runDir = path.join(home, "runs", runDirs(home)[0])

    expect(await statusCommand(parseArgs(["status", "--json"]), deps)).toBe(0)
    expect(JSON.parse(out.at(-1))).toMatchObject({
      lock: { state: "free" },
      run: {
        phase: "ended",
        pidState: "ended",
        result: "pass",
        stopReason: "completed",
        report: path.join(runDir, "report.html"),
        summaryMd: path.join(runDir, "summary.md"),
      },
    })
  })
})

// A stand-in runner: it holds the real lock, and on SIGTERM it writes
// summary.md and exits, as the end path does.
const RUNNER_SCRIPT = `
const fs = require("node:fs")
const path = require("node:path")
const { acquireLock } = require(${JSON.stringify(path.join(LIB, "lock.js"))})
const [home, runId] = process.argv.slice(2)
const runDir = path.join(home, "runs", runId)
fs.mkdirSync(runDir, { recursive: true })
acquireLock(home, { mode: "run", runId }).then(() => {
  process.on("SIGTERM", () => {
    fs.writeFileSync(path.join(runDir, "summary.md"), "# Release check\\n")
    process.exit(1)
  })
  fs.writeFileSync(path.join(runDir, "ready"), "")
  setInterval(() => {}, 1000)
})
`

describe("stop", () => {
  it("sends SIGTERM to the runner that holds the lock and waits for summary.md", async () => {
    const home = tempHome()
    const script = path.join(home, "runner.js")
    fs.writeFileSync(script, RUNNER_SCRIPT)
    const runner = childProcess.spawn(
      process.execPath,
      [script, home, RUN_ID],
      {
        stdio: "ignore",
      },
    )
    const exited = new Promise((resolve) => runner.once("exit", resolve))
    const ready = path.join(home, "runs", RUN_ID, "ready")
    expect(await waitFor(() => fs.existsSync(ready))).toBe(true)

    const { deps, out } = stubDeps(home)
    expect(await stopCommand(parseArgs(["stop"]), deps)).toBe(0)
    expect(out.at(-1)).toContain(path.join(home, "runs", RUN_ID, "summary.md"))
    await exited
  })

  it("signals nothing when the lock's pid now has another start time", async () => {
    const home = tempHome()
    fs.writeFileSync(
      lockPath(home),
      JSON.stringify({
        pid: process.pid,
        processStart: "Thu Jan  1 00:00:00 1970",
        mode: "run",
        runId: RUN_ID,
      }),
    )
    const signalled = []
    const { deps, err } = stubDeps(home, {
      kill: (pid, signal) => signalled.push([pid, signal]),
      stopWaitMs: 100,
    })
    expect(await stopCommand(parseArgs(["stop"]), deps)).toBe(2)
    expect(signalled).toEqual([])
    expect(err.join("\n")).toContain("recover")
  })
})

describe("recover", () => {
  it("reports an orphan run as runner_killed with its completed phases", async () => {
    const home = tempHome()
    const runDir = path.join(home, "runs", RUN_ID)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify({
        runId: RUN_ID,
        commit: COMMIT,
        scope: "release",
        devices: ["iphone-se"],
        startedAt: "2026-10-22T02:10:00.000Z",
      }),
    )
    fs.writeFileSync(
      path.join(runDir, "events.jsonl"),
      [
        { ts: "t", type: "phase", phase: "building" },
        { ts: "t", type: "phase_done", phase: "building" },
        { ts: "t", type: "phase", phase: "checking" },
        { ts: "t", type: "phase_done", phase: "checking" },
        { ts: "t", type: "phase", phase: "probing" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    )
    fs.writeFileSync(
      lockPath(home),
      JSON.stringify({
        pid: endedPid(),
        processStart: "x",
        mode: "run",
        runId: RUN_ID,
      }),
    )
    const { deps, calls } = stubDeps(home)
    expect(await recoverCommand(parseArgs(["recover"]), deps)).toBe(0)

    expect(readJson(path.join(runDir, "summary.json"))).toMatchObject({
      runId: RUN_ID,
      stopReason: "runner_killed",
      completedPhases: ["building", "checking"],
      result: "fail",
      exitCode: 1,
    })
    expect(fs.existsSync(path.join(runDir, "summary.md"))).toBe(true)
    expect(calls.stopOwned).toHaveLength(1)
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })
})
