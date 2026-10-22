/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require, setTimeout */
// The run lifecycle (KTD13, R38): one end path for every started run, a
// stale lock that the next run takes over, ports held at consent, a detached
// child, phase time limits, and the status, stop, and recover modes.
const childProcess = require("node:child_process")
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
  spawnDetached,
  statusCommand,
  stopCommand,
} = require("../lib/lifecycle")
const { lockPath } = require("../lib/lock")
const { readJson } = require("../lib/lists")
const { planCommand } = require("../lib/plan")

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

describe("a stale lock", () => {
  it("shows as stale in plan and does not block the next run", async () => {
    const home = tempHome()
    const dead = {
      pid: endedPid(),
      processStart: "Thu Oct 22 01:00:00 2026",
      mode: "run",
      runId: "2026-10-22T01-00-00Z-dead",
    }
    fs.writeFileSync(lockPath(home), JSON.stringify(dead))
    const { deps, out } = stubDeps(home)

    expect(await planCommand(parseArgs(["plan", "--json"]), deps)).toBe(0)
    const shown = JSON.parse(out.at(-1))
    expect(shown.lock).toMatchObject({
      state: "stale",
      reason: "pid_ended",
      pid: dead.pid,
    })
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
