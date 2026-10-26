/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, afterAll, afterEach, describe, expect, it, require */
// The speed pass (U9, KTD19, R10, R31, R35) with fake devices, a fake Maestro,
// and fake children. Two tests run the real lifecycle; one of them runs the
// real read-only server against a fake upstream on 127.0.0.1.
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { getOperationAST, print } = require("graphql")

const { parseArgs } = require("../lib/contract")
const { createDeps, runCommand } = require("../lib/lifecycle")
const {
  CONFIG_DIR,
  JOURNEYS_DIR,
  REPO_ROOT,
  copyJourneys,
  readJson,
} = require("../lib/lists")
const { createReadOnlyServer } = require("../lib/server/server")
const {
  createSpeedPhase,
  firstFrameSpan,
  linkFirstFrame,
  parseTotalTime,
  simulatorAppRssKb,
  timingStats,
} = require("../lib/speed")
const { readCommand } = require("../lib/journeys/results")
const { GET_VIDEO_BY_SLUG } = require("../../src/lib/queries")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const GB = 1024 ** 3
const DEVICES = readJson(path.join(CONFIG_DIR, "devices.json"))
const SETTINGS = readJson(path.join(CONFIG_DIR, "test-settings.json"))
const OK = { ok: true, class: null, step: null, error: null, stdout: "" }
// The fake clock time at which the runner sends the Android watch link.
const LINK_SENT_AT = 8000

const tempDirs = []
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-speed-"))
  tempDirs.push(dir)
  return dir
}

const SPEED_FLOWS = path.join(JOURNEYS_DIR, "_speed")

// A run folder that holds the run's checked copy of the speed flows.
function runDirWithCopy() {
  const runDir = tempDir()
  copyJourneys(SPEED_FLOWS, path.join(runDir, "journeys", "_speed"))
  return runDir
}

function deviceOf(id) {
  return DEVICES.devices.find((device) => device.id === id)
}

function childResult(stdout = "", code = 0) {
  return {
    code,
    signal: null,
    timedOut: false,
    stopped: false,
    stdout,
    stderr: "",
    durationMs: 1,
    error: null,
  }
}

function amStartOutput(totalTime) {
  return [
    "Starting: Intent { cmp=org.jesusfilm.forgewatch/.MainActivity }",
    "Status: ok",
    "LaunchState: COLD",
    "Activity: org.jesusfilm.forgewatch/.MainActivity",
    `TotalTime: ${totalTime}`,
    `WaitTime: ${totalTime + 4}`,
    "Complete",
  ].join("\n")
}

function meminfoOutput(rssKb) {
  return [
    "** MEMINFO in pid 4242 [org.jesusfilm.forgewatch] **",
    " App Summary",
    "           TOTAL PSS:   180000            TOTAL RSS:   " +
      `${rssKb}       TOTAL SWAP PSS:      104`,
  ].join("\n")
}

// Answers `am start -W` and `dumpsys meminfo` from queues; every other
// child (simctl uninstall, ps) succeeds with no output.
function fakeChildren({ amStart = [], meminfo = [], order = [] } = {}) {
  const calls = []
  async function run(command, args) {
    calls.push([command, ...args])
    const text = args.join(" ")
    if (text.includes("android.intent.action.VIEW")) order.push("link")
    if (text.includes("am start -W")) return amStart.shift()
    if (text.includes("dumpsys meminfo")) {
      return childResult(meminfoOutput(meminfo.shift() ?? 0))
    }
    return childResult()
  }
  return { calls, run }
}

function step(label, timestamp, duration, status = "COMPLETED", depth = 0) {
  return {
    command: { assertConditionCommand: { label } },
    metadata: { status, timestamp, duration, depth },
  }
}

// Each sample: the first screen at 1.0 s, Home at 2.5 s, the first frame 2.0 s
// after the link opens.
function stepsOf(flow) {
  if (flow === "speed-cold-launch") {
    return [
      step("Launch the app", 1000, 300),
      step("The first screen shows", 1300, 700),
      step("Home content shows", 2000, 1500),
    ]
  }
  if (flow === "speed-first-frame-android") {
    return [step("The first video frame shows", LINK_SENT_AT - 1000, 3000)]
  }
  return [
    step("Open the birth of Jesus video", 9000, 200),
    step("The first video frame shows", 9200, 1800),
  ]
}

function fakeMaestro({ onFlow = async () => {}, order = [] } = {}) {
  const calls = []
  async function run(options) {
    const flow = path.basename(options.flowFile, ".yaml")
    calls.push({ flow, deviceRef: options.deviceRef })
    order.push(`maestro ${flow}`)
    await onFlow(flow)
    const dir = path.join(options.outputDir, "debug", flow)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "commands.json"),
      JSON.stringify(stepsOf(flow)),
    )
    return childResult()
  }
  return { calls, run }
}

function fakeEmulator(device) {
  return {
    id: device.id,
    platform: "android",
    serial: `emulator-${device.consolePort}`,
    boot: async () => OK,
    shutdown: async () => OK,
    install: async () => OK,
    prepareApp: async () => OK,
    terminate: async () => OK,
  }
}

function fakeSimulator(device) {
  return {
    id: device.id,
    platform: "ios",
    udid: device.udid,
    boot: async () => OK,
    shutdown: async () => OK,
    install: async () => OK,
    terminate: async () => OK,
  }
}

const ownedSimulators = async () => ({
  owned: [{ id: "iphone-se", udid: "SE-UDID" }],
})

// ── The real lifecycle with stub layers ──────────────────────────────

function passingJourneys({ selection }) {
  return {
    attempts: selection.devices.flatMap((device) =>
      selection.journeys.map((journey) => ({
        journey,
        deviceId: device.id,
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
      })),
    ),
    screens: { gaps: [], notReached: [], skippedPlatforms: [] },
  }
}

function runDeps(home, overrides = {}) {
  const groups = {
    git: {
      head: async () => COMMIT,
      dirty: async () => [],
      objectId: async (commit, rel) => `${commit}:${rel}`,
      show: async () => "type Query { ok: Boolean }",
    },
    setup: {
      check: async () => ({
        ready: true,
        check: true,
        problems: [],
        notes: [],
        devices: [],
        downloads: [],
        actions: [],
        observed: { hostTimezone: "Etc/UTC" },
      }),
    },
    devices: {
      list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
      stopOwned: async () => [],
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
        lanes: [],
        reason: null,
        message: null,
      }),
      create: () => ({
        admit: async () => ({ admitted: true }),
        release: () => {},
      }),
    },
    server: {
      create: () => ({
        bind: async () => {},
        startAnswering: () => {},
        setLaneDevice: () => {},
        setSpeedMode: () => {},
        stats: () => ({ routes: {}, rateLimitRefusals: [] }),
        close: async () => {},
      }),
    },
    build: {
      buildTestApps: async (options) => {
        fs.mkdirSync(options.buildDir, { recursive: true })
        return {
          ok: true,
          platforms: {
            ios: { artifact: "/builds/ios/forgewatch.app" },
            android: { artifact: "/builds/android/app-release.apk" },
          },
        }
      },
      checkArtifact: async () => ({ findings: [] }),
    },
    phases: {
      probing: async () => ({ passed: true, findings: [] }),
      journeys: async (ctx) => passingJourneys(ctx),
    },
  }
  const merged = {
    home,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    out: () => {},
    err: () => {},
    stdin: { isTTY: false },
    signals: new EventEmitter(),
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
    stopChildren: async () => {},
    caffeinate: async () => {},
    macTimeZone: () => "Etc/UTC",
    ...overrides,
  }
  for (const [group, value] of Object.entries(groups)) {
    merged[group] = { ...value, ...overrides[group] }
  }
  return createDeps(merged)
}

function onlyRunDir(home) {
  const names = fs.readdirSync(path.join(home, "runs"))
  expect(names).toHaveLength(1)
  return path.join(home, "runs", names[0])
}

// ── A fake admin and the HTTP helpers (as in server.test.js) ─────────

function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen({ port, host }, () => resolve(server.address().port))
  })
}

function closeOf(server) {
  return () =>
    new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
}

// A port that is free on both 127.0.0.1 and ::1.
async function freePort() {
  for (;;) {
    const v4 = http.createServer()
    const port = await listenOn(v4, 0, "127.0.0.1")
    const v6 = http.createServer()
    const free = await listenOn(v6, port, "::1").then(
      () => true,
      () => false,
    )
    await closeOf(v4)()
    if (free) await closeOf(v6)()
    if (free) return port
  }
}

async function startUpstream() {
  const received = []
  const server = http.createServer((request, response) => {
    let raw = ""
    request.on("data", (chunk) => (raw += chunk))
    request.on("end", () => {
      received.push(JSON.parse(raw))
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: { videoBySlug: { id: "v1" } } }))
    })
  })
  const port = await listenOn(server, 0, "127.0.0.1")
  cleanups.push(closeOf(server))
  return { received, url: `http://127.0.0.1:${port}/api/graphql` }
}

function bodyOf(document, variables) {
  return JSON.stringify({
    operationName: getOperationAST(document)?.name?.value ?? null,
    query: print(document),
    variables,
  })
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/graphql",
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json" },
      },
      (response) => {
        response.resume()
        response.on("end", resolve)
      },
    )
    request.on("error", reject)
    request.end(body)
  })
}

// ── Tests ────────────────────────────────────────────────────────────

describe("the speed numbers (KTD19)", () => {
  it("parses `am start -W` output with TotalTime: 2143 as 2143 ms", () => {
    expect(parseTotalTime(amStartOutput(2143))).toBe(2143)
  })

  it("gives a median of 2.1 s, a minimum of 2.0 s, and a maximum of 2.4 s for 2.1 s, 2.4 s, and 2.0 s", () => {
    expect(timingStats([2100, 2400, 2000])).toEqual({
      median: 2100,
      min: 2000,
      max: 2400,
      samples: [2100, 2400, 2000],
    })
  })

  it("times the first frame from the end of the tap when iOS asks to open the link", () => {
    const commands = [
      step("Open the birth of Jesus video", 9000, 200),
      step("The first video frame shows", 9200, 20000, "WARNED"),
      step("Answer the open prompt when it shows", 29200, 2800),
      step("Confirm the open prompt", 29300, 600, "COMPLETED", 1),
      step(
        "The first video frame shows after the prompt",
        29900,
        2100,
        "COMPLETED",
        1,
      ),
    ].map(readCommand)
    expect(firstFrameSpan(commands)).toBe(2100)
  })

  it("does not time an Android first frame whose wait started after the link", () => {
    const late = [
      step("The first video frame shows", LINK_SENT_AT + 500, 1500),
    ].map(readCommand)
    expect(linkFirstFrame(late, LINK_SENT_AT)).toEqual({
      ms: null,
      error:
        "Maestro started its wait after the link, so the time is not exact",
    })
  })

  it("reads the resident memory of the app on this device's simulator only", () => {
    const sims = "/Users/u/Library/Developer/CoreSimulator/Devices"
    const ps = [
      `  512000 ${sims}/OTHER-UDID/data/Containers/Bundle/Application/A/forgewatch.app/forgewatch`,
      `  204800 ${sims}/SE-UDID/data/Containers/Bundle/Application/B/forgewatch.app/forgewatch`,
      `  600000 ${sims}/SE-UDID/data/Containers/Bundle/Application/B/forgewatch.app/PlugIns/Share.appex/Share`,
      `   30720 ${sims}/SE-UDID/data/Containers/Bundle/Application/C/maestro-driver-iosUITests-Runner.app/maestro-driver-iosUITests-Runner`,
      "   10240 /usr/bin/xcrun simctl launch SE-UDID org.jesusfilm.forgewatch",
    ].join("\n")
    expect(simulatorAppRssKb(ps, "SE-UDID", "forgewatch.app")).toBe(204800)
    expect(simulatorAppRssKb(ps, "NEW-UDID", "forgewatch.app")).toBeNull()
  })
})

describe("the speed phase", () => {
  it("names a device whose layer throws, and still measures the next device (R31)", async () => {
    const released = []
    const children = fakeChildren({
      amStart: [2100, 2000, 2050].map((ms) => childResult(amStartOutput(ms))),
    })
    const phase = createSpeedPhase({
      listInventory: ownedSimulators,
      createSimulator: () => {
        throw new Error("simctl exploded")
      },
      createEmulator: fakeEmulator,
      runChild: children.run,
      runMaestro: fakeMaestro().run,
      memoryPollMs: 5,
      now: () => LINK_SENT_AT,
      linkLeadMs: 0,
    })
    const result = await phase({
      signal: new AbortController().signal,
      runDir: runDirWithCopy(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      selection: {
        devices: [deviceOf("iphone-se"), deviceOf("android-phone")],
      },
      settings: SETTINGS,
      devicesConfig: DEVICES,
      artifacts: { android: "/builds/android/app-release.apk" },
      server: { setLaneDevice: () => {} },
      gate: {
        admit: async () => ({ admitted: true }),
        release: (device) => released.push(device.id),
      },
      event: () => {},
    })
    expect(result.devices[0]).toEqual({
      deviceId: "iphone-se",
      coldLaunchMs: null,
      homeContentMs: null,
      firstFrameMs: null,
      peakMemoryMb: null,
      failures: ["The speed pass stopped on this device: simctl exploded."],
    })
    expect(result.devices[1]).toMatchObject({
      deviceId: "android-phone",
      coldLaunchMs: { median: 2050, min: 2000, max: 2100 },
      failures: [],
    })
    expect(released).toEqual(["iphone-se", "android-phone"])
  })

  function phaseContext(runDir) {
    return {
      signal: new AbortController().signal,
      runDir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      selection: { devices: [deviceOf("android-phone")] },
      settings: SETTINGS,
      devicesConfig: DEVICES,
      artifacts: { android: "/builds/android/app-release.apk" },
      server: { setLaneDevice: () => {} },
      gate: { admit: async () => ({ admitted: true }), release: () => {} },
      event: () => {},
    }
  }

  function androidPhase() {
    return createSpeedPhase({
      createEmulator: fakeEmulator,
      runChild: fakeChildren({
        amStart: [2100, 2000, 2050].map((ms) => childResult(amStartOutput(ms))),
      }).run,
      runMaestro: fakeMaestro().run,
      memoryPollMs: 5,
      now: () => LINK_SENT_AT,
      linkLeadMs: 0,
    })
  }

  it("runs the speed flows of the run's checked copy, not of the checkout", async () => {
    const runDir = runDirWithCopy()
    const copied = path.join(
      runDir,
      "journeys",
      "_speed",
      "speed-cold-launch.yaml",
    )
    fs.appendFileSync(copied, "# the checked copy\n")

    const result = await androidPhase()(phaseContext(runDir))

    expect(result.devices[0]).toMatchObject({
      deviceId: "android-phone",
      failures: [],
    })
    expect(
      fs.readFileSync(
        path.join(runDir, "speed", "flows", "speed-cold-launch.yaml"),
        "utf8",
      ),
    ).toBe(fs.readFileSync(copied, "utf8"))
  })

  it("measures nothing when the run has no checked copy of the speed flows", async () => {
    const result = await androidPhase()(phaseContext(tempDir()))

    expect(result.devices).toEqual([
      expect.objectContaining({
        deviceId: "android-phone",
        coldLaunchMs: null,
        failures: [
          expect.stringMatching(
            /^Not measured: the speed flows cannot be read: ENOENT/,
          ),
        ],
      }),
    ])
  })

  it("does not stop an emulator whose serial another session holds", async () => {
    const stops = []
    const released = []
    const inUse =
      "emulator-5640 is already in use, so the runner does not start forge_rc_phone on it"
    const phase = createSpeedPhase({
      listInventory: ownedSimulators,
      createSimulator: fakeSimulator,
      createEmulator: (device) => ({
        ...fakeEmulator(device),
        boot: async () => ({ ...OK, ok: false, refused: true, error: inUse }),
        shutdown: async () => {
          stops.push(device.id)
          return OK
        },
      }),
      runChild: fakeChildren().run,
      runMaestro: fakeMaestro().run,
      memoryPollMs: 5,
      now: () => LINK_SENT_AT,
      linkLeadMs: 0,
    })
    const result = await phase({
      signal: new AbortController().signal,
      runDir: runDirWithCopy(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      selection: { devices: [deviceOf("android-phone")] },
      settings: SETTINGS,
      devicesConfig: DEVICES,
      artifacts: { android: "/builds/android/app-release.apk" },
      server: { setLaneDevice: () => {} },
      gate: {
        admit: async () => ({ admitted: true }),
        release: (device) => released.push(device.id),
      },
      event: () => {},
    })
    expect(result.devices[0].failures).toEqual([
      `Not measured: the device did not start: ${inUse}.`,
    ])
    expect(stops).toEqual([])
    expect(released).toEqual(["android-phone"])
  })
})

describe("the Android first frame", () => {
  it("sends the watch link itself after Maestro starts to wait, and times the frame from the link", async () => {
    const order = []
    const children = fakeChildren({
      amStart: [2100, 2000, 2050].map((ms) => childResult(amStartOutput(ms))),
      order,
    })
    const phase = createSpeedPhase({
      createEmulator: fakeEmulator,
      runChild: children.run,
      runMaestro: fakeMaestro({ order }).run,
      memoryPollMs: 5,
      now: () => LINK_SENT_AT,
      linkLeadMs: 0,
    })
    const result = await phase({
      signal: new AbortController().signal,
      runDir: runDirWithCopy(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      selection: { devices: [deviceOf("android-phone")] },
      settings: SETTINGS,
      devicesConfig: DEVICES,
      artifacts: { android: "/builds/android/app-release.apk" },
      server: { setLaneDevice: () => {} },
      gate: { admit: async () => ({ admitted: true }), release: () => {} },
      event: () => {},
    })
    // The fake wait starts 1 s before the link and ends 3 s after its start.
    expect(result.devices[0].firstFrameMs).toEqual({
      median: 2000,
      min: 2000,
      max: 2000,
      samples: [2000, 2000, 2000],
    })
    const links = children.calls.filter((call) =>
      call.includes("android.intent.action.VIEW"),
    )
    expect(links).toHaveLength(3)
    expect(links[0].slice(1)).toEqual([
      "-s",
      "emulator-5640",
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "forgemobile://watch/the-birth-of-jesus",
      "org.jesusfilm.forgewatch",
    ])
    expect(
      order.filter((entry) => entry !== "maestro speed-cold-launch"),
    ).toEqual([
      "maestro speed-first-frame-android",
      "link",
      "maestro speed-first-frame-android",
      "link",
      "maestro speed-first-frame-android",
      "link",
    ])
  })
})

describe("the speed pass in a run", () => {
  it("reports two samples and names the failed launch, and the run result stays the same (R31)", async () => {
    const children = fakeChildren({
      amStart: [
        childResult(amStartOutput(2100)),
        childResult(
          "Starting: Intent { cmp=org.jesusfilm.forgewatch/.MainActivity }\nError: Activity not started, unable to resolve Intent",
        ),
        childResult(amStartOutput(2000)),
      ],
      meminfo: [307200, 409600, 307200, 307200, 307200, 307200],
    })
    const speed = createSpeedPhase({
      flowsDir: SPEED_FLOWS,
      createEmulator: fakeEmulator,
      runChild: children.run,
      runMaestro: fakeMaestro().run,
      memoryPollMs: 5,
      now: () => LINK_SENT_AT,
      linkLeadMs: 0,
    })
    const args = ["run", "--yes", "--device", "android-phone"]
    const withSpeed = tempDir()
    const skipped = tempDir()

    expect(
      await runCommand(
        parseArgs(args),
        runDeps(withSpeed, { phases: { speed } }),
      ),
    ).toBe(0)
    expect(
      await runCommand(
        parseArgs([...args, "--skip-speed-pass"]),
        runDeps(skipped, { phases: { speed } }),
      ),
    ).toBe(0)

    const summary = readJson(path.join(onlyRunDir(withSpeed), "summary.json"))
    const baseline = readJson(path.join(onlyRunDir(skipped), "summary.json"))
    expect(summary.speed.devices).toEqual([
      {
        deviceId: "android-phone",
        coldLaunchMs: {
          median: 2050,
          min: 2000,
          max: 2100,
          samples: [2100, 2000],
        },
        homeContentMs: {
          median: 2500,
          min: 2500,
          max: 2500,
          samples: [2500, 2500, 2500],
        },
        firstFrameMs: {
          median: 2000,
          min: 2000,
          max: 2000,
          samples: [2000, 2000, 2000],
        },
        peakMemoryMb: 400,
        failures: [
          "Sample 2, cold launch: am start -W gave no TotalTime: Error: Activity not started, unable to resolve Intent.",
        ],
      },
    ])
    expect(baseline.speed).toBeNull()
    expect([summary.result, summary.exitCode]).toEqual([
      baseline.result,
      baseline.exitCode,
    ])
    expect(summary.result).toBe("pass")
  })

  it("puts the server in speed-pass mode, so a second identical read reaches production (R35)", async () => {
    const upstream = await startUpstream()
    const lanes = [
      { lane: "ios", port: await freePort() },
      { lane: "androidPhone", port: await freePort() },
      { lane: "androidTablet", port: await freePort() },
    ]
    const iosPort = lanes[0].port
    const read = bodyOf(GET_VIDEO_BY_SLUG, { slug: "jesus" })
    const home = tempDir()
    const deps = runDeps(home, {
      lanes: () => lanes,
      git: {
        show: async () =>
          fs.readFileSync(
            path.join(REPO_ROOT, "apps/admin/schema.graphql"),
            "utf8",
          ),
      },
      server: {
        create: (options) =>
          createReadOnlyServer({ ...options, upstreamUrl: upstream.url }),
      },
      phases: {
        journeys: async (ctx) => {
          ctx.server.setLaneDevice("ios", "iphone-se")
          await post(iosPort, read)
          await post(iosPort, read)
          return passingJourneys(ctx)
        },
        speed: createSpeedPhase({
          flowsDir: SPEED_FLOWS,
          listInventory: ownedSimulators,
          createSimulator: fakeSimulator,
          runChild: fakeChildren().run,
          runMaestro: fakeMaestro({
            onFlow: (flow) =>
              flow === "speed-cold-launch" ? post(iosPort, read) : null,
          }).run,
          memoryPollMs: 5,
        }),
      },
    })

    expect(
      await runCommand(
        parseArgs(["run", "--yes", "--device", "iphone-se"]),
        deps,
      ),
    ).toBe(0)

    const lines = fs
      .readFileSync(path.join(onlyRunDir(home), "server-log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => line.opName === "GetVideoBySlug")
    expect(lines.map((line) => line.route)).toEqual([
      "forwarded",
      "reused",
      "forwarded",
      "forwarded",
      "forwarded",
    ])
    expect(upstream.received).toHaveLength(4)
    expect(lines.every((line) => line.deviceId === "iphone-se")).toBe(true)
  })
})
