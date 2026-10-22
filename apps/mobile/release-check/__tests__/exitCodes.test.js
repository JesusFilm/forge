/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// KTD13 exit codes: 0 only when a non-empty scope passed, 1 when a started
// run failed for any R26 reason, and 2 for a refusal before any side effect.
// Every layer below the lifecycle is a stub, so no test builds or boots.
const childProcess = require("node:child_process")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { parseArgs } = require("../lib/contract")
const { createDeps, runCommand } = require("../lib/lifecycle")
const { processStart } = require("../lib/lock")
const { readJson } = require("../lib/lists")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const GB = 1024 ** 3
const DEVICES = readJson(path.join(__dirname, "..", "config", "devices.json"))

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-exit-"))
  tempDirs.push(dir)
  return dir
}

function readySetup() {
  return {
    ready: true,
    check: true,
    problems: [],
    notes: [],
    devices: DEVICES.devices.map((device) => ({ id: device.id, status: "ok" })),
    downloads: [{ package: "image", approxMb: 1697, installed: true }],
    actions: [],
    observed: { hostTimezone: "Etc/UTC", xcode: "26.5", maestro: "2.11.0" },
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
    stepTimes: [{ label: "launch", ms: 900 }],
    restart: false,
    notRunSteps: [],
    knownBugTicket: null,
    screensReached: ["home"],
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

// Every side-effecting layer records its calls, so a refusal can prove that
// nothing ran. Reads (git, setup check, device list) are part of the plan.
function stubDeps(home, overrides = {}) {
  const calls = {
    build: [],
    check: [],
    server: [],
    stopOwned: 0,
    setupApply: 0,
    caffeinate: 0,
    stopChildren: 0,
  }
  const out = []
  const err = []
  const server = {
    bind: async () => calls.server.push("bind"),
    startAnswering: () => calls.server.push("startAnswering"),
    setLaneDevice: () => {},
    setSpeedMode: () => {},
    stats: () => ({ routes: { forwarded: 2 }, rateLimitRefusals: [] }),
    close: async () => calls.server.push("close"),
  }
  const groups = {
    git: {
      head: async () => COMMIT,
      dirty: async () => [],
      objectId: async (commit, rel) => `${commit}:${rel}`,
      show: async () => "type Query { ok: Boolean }",
    },
    setup: {
      check: async () => readySetup(),
      apply: async () => {
        calls.setupApply += 1
        return readySetup()
      },
    },
    devices: {
      list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
      stopOwned: async () => {
        calls.stopOwned += 1
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
      create: (options) => {
        calls.server.push("create")
        calls.serverOptions = options
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
            ios: {
              artifact: path.join(options.buildDir, "ios/forgewatch.app"),
            },
            android: {
              artifact: path.join(options.buildDir, "android/app-release.apk"),
            },
          },
        }
      },
      checkArtifact: async (file) => {
        calls.check.push(file)
        return { findings: [] }
      },
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
    ask: async () => "n",
    signals: new EventEmitter(),
    heartbeatMs: 60_000,
    graceMs: 50,
    journeyIds: () => ["cold-launch-home"],
    buildInputs: () => ["apps/mobile", "pnpm-lock.yaml"],
    logCheck: () => ({
      passed: true,
      findings: [],
      perDevice: { "iphone-se": 4 },
      routes: { forwarded: 2 },
      rateLimitRefusals: [],
    }),
    stopChildren: async () => {
      calls.stopChildren += 1
    },
    caffeinate: async () => {
      calls.caffeinate += 1
    },
    macTimeZone: () => "Pacific/Auckland",
    ...overrides,
  }
  for (const [group, value] of Object.entries(groups)) {
    merged[group] = { ...value, ...overrides[group] }
  }
  return { deps: createDeps(merged), calls, out, err }
}

function runArgs(...extra) {
  return parseArgs(["run", "--yes", ...extra])
}

function onlyRunDir(home) {
  const runs = path.join(home, "runs")
  const names = fs.existsSync(runs) ? fs.readdirSync(runs) : []
  expect(names).toHaveLength(1)
  return path.join(runs, names[0])
}

function summaryOf(home) {
  return readJson(path.join(onlyRunDir(home), "summary.json"))
}

describe("exit 0", () => {
  it("passes a release run whose non-empty scope passed every check", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home)
    expect(await runCommand(runArgs(), deps)).toBe(0)
    expect(summaryOf(home)).toMatchObject({
      scope: "release",
      result: "pass",
      exitCode: 0,
      stopReason: "completed",
      completedPhases: [
        "building",
        "checking",
        "probing",
        "journeys",
        "speed",
        "logcheck",
      ],
    })
  })

  it("fails the same run when the journeys produce no attempt", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home, {
      phases: {
        journeys: async () => ({
          attempts: [],
          screens: { gaps: [], notReached: [], skippedPlatforms: [] },
        }),
      },
    })
    expect(await runCommand(runArgs(), deps)).toBe(1)
    expect(summaryOf(home)).toMatchObject({ result: "fail", exitCode: 1 })
  })

  it("marks a narrowed run partial, never a release result", async () => {
    const home = tempHome()
    const { deps } = stubDeps(home)
    expect(
      await runCommand(runArgs("--platform", "ios", "--skip-speed-pass"), deps),
    ).toBe(0)
    expect(summaryOf(home)).toMatchObject({ scope: "partial", result: "pass" })
  })
})

function journeysReturning(fields) {
  return async (ctx) => ({ ...passingJourneys(ctx), ...fields })
}

const failed = (fields) =>
  attempt("cold-launch-home", "iphone-se", {
    status: "failed",
    label: "new",
    class: "assertion_failed",
    failedStep: "Home shows",
    error: "Assertion is false",
    ...fields,
  })

const current = { calls: null }

// R26 lists every failure kind; each one fails the run.
const FAILURES = [
  {
    name: "a journey failure",
    overrides: {
      phases: { journeys: journeysReturning({ attempts: [failed()] }) },
    },
    stopReason: "completed",
  },
  {
    name: "a crash",
    overrides: {
      phases: {
        journeys: journeysReturning({
          attempts: [failed({ class: "app_crashed" })],
        }),
      },
    },
    stopReason: "completed",
  },
  {
    name: "a known bug",
    overrides: {
      phases: {
        journeys: journeysReturning({
          attempts: [failed({ label: "known", knownBugTicket: "FORGE-1" })],
        }),
      },
    },
    stopReason: "completed",
  },
  {
    name: "a flaky journey",
    overrides: {
      phases: {
        journeys: journeysReturning({
          attempts: [
            failed({ label: "flaky" }),
            attempt("cold-launch-home", "iphone-se", {
              attempt: 2,
              label: "flaky",
            }),
          ],
        }),
      },
    },
    stopReason: "completed",
  },
  {
    name: "a screen list gap",
    overrides: {
      phases: {
        journeys: journeysReturning({
          screens: {
            gaps: [{ screen: "tab-explore", platform: "ios" }],
            notReached: [],
            skippedPlatforms: [],
          },
        }),
      },
    },
    stopReason: "completed",
  },
  {
    name: "a failed build check",
    overrides: {
      build: {
        checkArtifact: async () => ({
          findings: [
            {
              code: "DATADOG_TOKEN_PRESENT",
              message: "The bundle contains a Datadog client token.",
              setting: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
              file: null,
              deviceId: null,
            },
          ],
        }),
      },
    },
    stopReason: "build_check_failed",
  },
  {
    name: "a failed log check",
    overrides: {
      logCheck: () => ({
        passed: false,
        findings: [
          {
            code: "FORWARDED_MUTATION",
            message: "log line 3 forwarded a mutation.",
            setting: null,
            file: null,
            deviceId: null,
          },
        ],
        perDevice: { "iphone-se": 3 },
        routes: { forwarded: 3 },
        rateLimitRefusals: [],
      }),
    },
    stopReason: "completed",
  },
  {
    name: "a failed settings probe",
    overrides: {
      phases: { probing: async () => ({ passed: false, findings: [] }) },
    },
    stopReason: "probe_failed",
  },
  {
    name: "a build failure",
    overrides: {
      build: {
        buildTestApps: async () => ({
          ok: false,
          failedStep: "ios:ios-xcodebuild",
        }),
      },
    },
    stopReason: "build_failed",
  },
  {
    name: "a setup failure",
    args: ["--allow-setup"],
    overrides: {
      setup: {
        check: async () => ({ ...readySetup(), ready: false }),
        apply: async () => ({
          ...readySetup(),
          ready: false,
          problems: [{ code: "AVD_CREATE_FAILED", message: "No AVD." }],
        }),
      },
    },
    stopReason: "setup_failed",
  },
  {
    name: "an unavailable upstream",
    overrides: {
      phases: {
        journeys: async (ctx) => {
          current.calls.serverOptions.onUpstreamUnavailable()
          return passingJourneys(ctx)
        },
      },
    },
    stopReason: "upstream_unavailable",
  },
  {
    name: "a gate wait past its limit",
    overrides: {
      gate: {
        create: () => ({
          admit: async () => ({
            admitted: false,
            stopReason: "host_overload",
            message: "iphone-se waited 15 min",
          }),
          release: () => {},
        }),
      },
      phases: {
        journeys: async (ctx) => {
          await ctx.admit(ctx.selection.devices[0])
          return passingJourneys(ctx)
        },
      },
    },
    stopReason: "host_overload",
  },
  {
    name: "a runner error",
    overrides: {
      phases: {
        journeys: async () => {
          throw new TypeError("journey runner bug")
        },
      },
    },
    stopReason: "runner_error",
  },
]

describe("exit 1", () => {
  it.each(FAILURES)("fails the run on $name", async (row) => {
    const home = tempHome()
    const stub = stubDeps(home, row.overrides)
    current.calls = stub.calls
    expect(await runCommand(runArgs(...(row.args ?? [])), stub.deps)).toBe(1)
    expect(summaryOf(home)).toMatchObject({
      result: "fail",
      exitCode: 1,
      stopReason: row.stopReason,
    })
    expect(stub.calls.server).toContain("close")
    expect(stub.calls.stopOwned).toBe(1)
    expect(fs.existsSync(path.join(home, "lock.json"))).toBe(false)
  })
})

function expectNoSideEffect(home, calls) {
  expect(calls.build).toEqual([])
  expect(calls.check).toEqual([])
  expect(calls.server).toEqual([])
  expect(calls.stopOwned).toBe(0)
  expect(calls.setupApply).toBe(0)
  expect(calls.caffeinate).toBe(0)
  expect(fs.existsSync(path.join(home, "runs"))).toBe(false)
}

describe("exit 2 (AE11)", () => {
  it("names each changed build input and builds nothing", async () => {
    const home = tempHome()
    const changed = ["apps/mobile/src/env.ts", "pnpm-lock.yaml"]
    const { deps, calls, err } = stubDeps(home, {
      git: { dirty: async () => changed },
    })
    expect(await runCommand(runArgs(), deps)).toBe(2)
    expect(err.join("\n")).toContain("DIRTY_BUILD_INPUTS")
    for (const file of changed) expect(err.join("\n")).toContain(file)
    expectNoSideEffect(home, calls)
    expect(fs.existsSync(path.join(home, "lock.json"))).toBe(false)
  })

  it("refuses while a live runner holds the lock, and leaves its lock", async () => {
    const home = tempHome()
    const held = {
      pid: process.pid,
      processStart: await processStart(process.pid),
      mode: "run",
      runId: "2026-10-22T01-00-00Z-beef",
    }
    fs.writeFileSync(path.join(home, "lock.json"), JSON.stringify(held))
    const { deps, calls, err } = stubDeps(home)
    expect(await runCommand(runArgs(), deps)).toBe(2)
    expect(err.join("\n")).toContain("LOCK_HELD")
    expectNoSideEffect(home, calls)
    expect(readJson(path.join(home, "lock.json"))).toEqual(held)
  })

  it("refuses when HEAD differs from --expect-commit", async () => {
    const home = tempHome()
    const { deps, calls, err } = stubDeps(home)
    expect(
      await runCommand(runArgs("--expect-commit", "fedcba9876543210"), deps),
    ).toBe(2)
    expect(err.join("\n")).toContain("COMMIT_MISMATCH")
    expectNoSideEffect(home, calls)
  })

  it("refuses when setup reports a missing tool", async () => {
    const home = tempHome()
    const { deps, calls, err } = stubDeps(home, {
      setup: {
        check: async () => ({
          ...readySetup(),
          ready: false,
          problems: [
            {
              code: "MAESTRO_MISSING",
              message: "Maestro 2.11.0 is not installed.",
              command: "curl -fsSL https://get.maestro.mobile.dev | bash",
              deviceId: null,
            },
          ],
        }),
      },
    })
    expect(await runCommand(runArgs(), deps)).toBe(2)
    expect(err.join("\n")).toContain("MAESTRO_MISSING")
    expectNoSideEffect(home, calls)
  })

  it("refuses without --yes when stdin is not a terminal", async () => {
    const home = tempHome()
    const { deps, calls, err } = stubDeps(home)
    expect(await runCommand(parseArgs(["run"]), deps)).toBe(2)
    expect(err.join("\n")).toContain("NO_CONSENT")
    expectNoSideEffect(home, calls)
  })
})

describe("a journey selection that matches nothing", () => {
  it("refuses when no journey file exists", async () => {
    const home = tempHome()
    const { deps, calls, err } = stubDeps(home, { journeyIds: () => [] })
    expect(await runCommand(runArgs(), deps)).toBe(2)
    expect(err.join("\n")).toContain("NO_JOURNEY_MATCH")
    expectNoSideEffect(home, calls)
  })

  it("refuses a --journey id that has no file", async () => {
    const home = tempHome()
    const { deps, calls, err } = stubDeps(home)
    expect(
      await runCommand(runArgs("--journey", "no-such-journey"), deps),
    ).toBe(2)
    expect(err.join("\n")).toContain("UNKNOWN_JOURNEY")
    expectNoSideEffect(home, calls)
  })
})

describe("cli.mjs", () => {
  it("refuses an unknown run flag with exit 2 before any work", () => {
    const result = childProcess.spawnSync(
      process.execPath,
      [path.join(__dirname, "..", "cli.mjs"), "run", "--yes", "--deatch"],
      { encoding: "utf8" },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("unknown flag `--deatch` for `run`")
  })
})
