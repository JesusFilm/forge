/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, afterAll, afterEach, describe, expect, it, require */
// The one-device authoring session (KTD18, R7): the device name rule, the
// detached session process, one Maestro attempt per `session try`, and the
// log check that `session down` runs. No test touches a real device.
const childProcess = require("node:child_process")
const crypto = require("node:crypto")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

const { parseArgs } = require("../lib/contract")
const { runMaestro } = require("../lib/journeys/maestro")
const {
  CONFIG_DIR,
  JOURNEYS_DIR,
  REPO_ROOT,
  readJson,
} = require("../lib/lists")
const { lockPath, processStart } = require("../lib/lock")
const { postJson } = require("../lib/server/record")
const { createReadOnlyServer } = require("../lib/server/server")
const {
  SESSION_FILE,
  checkedBuild,
  createSessionDeps,
  resolveRunnerDevice,
  serveSession,
  sessionCommand,
} = require("../lib/session")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const UDID = "F97F0DDF-0000-4000-8000-000000000001"
const ADMIN_SCHEMA_SDL = fs.readFileSync(
  path.join(REPO_ROOT, "apps/admin/schema.graphql"),
  "utf8",
)
const DEVICES = readJson(path.join(CONFIG_DIR, "devices.json"))

const tempDirs = []
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function endedPid() {
  return childProcess.spawnSync("/usr/bin/true").pid
}

function listen(server, port, host) {
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
    const port = await listen(v4, 0, "127.0.0.1")
    const v6 = http.createServer()
    const free = await listen(v6, port, "::1").then(
      () => true,
      () => false,
    )
    await closeOf(v4)()
    if (free) await closeOf(v6)()
    if (free) return port
  }
}

/** A fake production admin that records each body and answers every read. */
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
  const port = await listen(server, 0, "127.0.0.1")
  cleanups.push(closeOf(server))
  return { received, url: `http://127.0.0.1:${port}/api/graphql` }
}

/** A config folder with the committed lists, lane ports, and copied values. */
function configWithPorts(ports = {}, copied = {}) {
  const dir = tempDir("release-check-session-config-")
  for (const name of fs.readdirSync(CONFIG_DIR)) {
    fs.copyFileSync(path.join(CONFIG_DIR, name), path.join(dir, name))
  }
  const file = path.join(dir, "test-settings.json")
  const settings = readJson(file)
  settings.ports = { ...settings.ports, ...ports }
  settings.copiedFromProduction = {
    ...settings.copiedFromProduction,
    ...copied,
  }
  fs.writeFileSync(file, JSON.stringify(settings))
  return dir
}

function fakeSimulator(events) {
  return (device) => ({
    id: device.id,
    platform: "ios",
    lane: device.lane,
    udid: device.udid,
    restarts: 0,
    boot: async () => {
      events.push(["boot", device.udid])
      return { ok: true }
    },
    install: async (app) => {
      events.push(["install", app])
      return { ok: true }
    },
    terminate: async () => ({ ok: true }),
    probe: async () => ({ ok: true }),
    shutdown: async () => {
      events.push(["shutdown", device.udid])
      return { ok: true }
    },
  })
}

function makeIosBuild(home) {
  const app = path.join(home, "builds", COMMIT, "ios", "forgewatch.app")
  fs.mkdirSync(app, { recursive: true })
  return app
}

function baseDeps(home, configDir, overrides = {}) {
  const out = []
  const err = []
  const deps = createSessionDeps({
    home,
    configDir,
    env: {
      HOME: os.homedir(),
      PATH: "/usr/bin:/bin",
      MAESTRO_BIN: "/opt/maestro-2.11.0/bin/maestro",
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    signals: new EventEmitter(),
    pollMs: 10,
    git: {
      head: async () => COMMIT,
      dirty: async () => [],
      show: async () => ADMIN_SCHEMA_SDL,
    },
    build: {
      checkArtifact: async () => ({ findings: [] }),
      buildTestApps: async () => {
        throw new Error("no build expected")
      },
    },
    listInventory: async () => ({ owned: [{ id: "iphone-se", udid: UDID }] }),
    ...overrides,
  })
  return { deps, out, err }
}

describe("session up", () => {
  it("refuses `iPhone 17 Pro`, because the name has no Forge RC prefix", async () => {
    const home = tempDir("release-check-session-")
    const spawned = []
    // A spawned child that never reports ends the wait at once, not after 2 h.
    const { deps, err } = baseDeps(home, CONFIG_DIR, {
      spawnDetached: (...args) => {
        spawned.push(args)
        return { pid: process.pid }
      },
      isAlive: () => false,
    })
    const command = parseArgs(["session", "up", "--device", "iPhone 17 Pro"])

    const code = await sessionCommand(command, deps)

    expect(code).toBe(2)
    expect(err.join("\n")).toMatch(
      /`iPhone 17 Pro` is not a runner device\..*names start with `Forge RC`/,
    )
    expect(spawned).toEqual([])
    expect(fs.existsSync(path.join(home, "sessions"))).toBe(false)
  })

  it("accepts a runner device id, its Forge RC name, and its forge_rc_ AVD", () => {
    expect(resolveRunnerDevice("iphone-se", DEVICES).device.id).toBe(
      "iphone-se",
    )
    expect(
      resolveRunnerDevice("Forge RC iPhone 17 Pro Max", DEVICES).device.id,
    ).toBe("iphone-17-pro-max")
    expect(resolveRunnerDevice("forge_rc_tablet", DEVICES).device.id).toBe(
      "android-tablet",
    )
    expect(
      resolveRunnerDevice("Forge RC iPhone 17", DEVICES).refusal.code,
    ).toBe("UNKNOWN_DEVICE")
  })

  it("starts a session process that holds the lock, the server, and the device until session down", async () => {
    const home = tempDir("release-check-session-")
    const port = await freePort()
    const configDir = configWithPorts({ hostIos: port })
    const artifact = makeIosBuild(home)
    const upstream = await startUpstream()
    const events = []
    const childSignals = new EventEmitter()
    let childRunning = false
    let childCode = null
    const shared = {
      createSimulator: fakeSimulator(events),
      server: {
        create: (options) =>
          createReadOnlyServer({ ...options, upstreamUrl: upstream.url }),
      },
      isAlive: (pid) => pid === process.pid && childRunning,
      kill: (pid, signal) => childSignals.emit(signal),
    }
    const child = baseDeps(home, configDir, {
      ...shared,
      signals: childSignals,
    })
    const parent = baseDeps(home, configDir, {
      ...shared,
      spawnDetached: (command, args) => {
        expect(args.slice(1, 2)).toEqual(["serve"])
        childRunning = true
        void serveSession(
          { sessionDir: args[2], deviceId: args[3] },
          child.deps,
        ).then((code) => {
          childCode = code
          childRunning = false
        })
        return { pid: process.pid }
      },
    })

    const upCode = await sessionCommand(
      parseArgs(["session", "up", "--device", "iphone-se"]),
      parent.deps,
    )

    expect(upCode).toBe(0)
    const printed = JSON.parse(parent.out[0])
    expect(printed).toEqual({
      deviceId: "iphone-se",
      appId: "org.jesusfilm.forgewatch",
      port,
      logPath: path.join(printed.sessionDir, "server-log.jsonl"),
      sessionDir: printed.sessionDir,
    })
    expect(printed.sessionDir.startsWith(path.join(home, "sessions"))).toBe(
      true,
    )
    const lock = readJson(lockPath(home))
    expect(lock).toMatchObject({ pid: process.pid, mode: "session" })
    expect(lock.processStart).toBe(await processStart(process.pid))
    const record = readJson(path.join(home, SESSION_FILE))
    expect(record).toMatchObject({
      state: "ready",
      pid: process.pid,
      processStart: lock.processStart,
      udid: UDID,
      artifact,
    })
    expect(events).toEqual([
      ["boot", UDID],
      ["install", artifact],
    ])

    // The device's own read, through the session's server.
    const read = await postJson(
      `http://127.0.0.1:${port}/api/graphql`,
      JSON.stringify({
        query: "query V($slug: String!) { videoBySlug(slug: $slug) { id } }",
        variables: { slug: "jesus" },
      }),
    )
    expect(read.json).toEqual({ data: { videoBySlug: { id: "v1" } } })

    const downCode = await sessionCommand(
      parseArgs(["session", "down"]),
      parent.deps,
    )

    expect(downCode).toBe(0)
    expect(childCode).toBe(0)
    expect(JSON.parse(parent.out[1])).toMatchObject({
      deviceId: "iphone-se",
      state: "ended",
      logCheck: { passed: true, perDevice: { "iphone-se": 1 } },
    })
    expect(events.at(-1)).toEqual(["shutdown", UDID])
    expect(fs.existsSync(lockPath(home))).toBe(false)
    expect(fs.existsSync(path.join(home, SESSION_FILE))).toBe(false)
    expect(upstream.received).toHaveLength(1)
  })
})

describe("build folders", () => {
  const OLDER = "1111111111111111111111111111111111111111"
  const OLD = "2222222222222222222222222222222222222222"
  const NEWEST = "3333333333333333333333333333333333333333"

  // Three builds of other commits, the newest last, as a day of sessions leaves.
  function otherBuilds(home) {
    for (const [index, commit] of [OLDER, OLD, NEWEST].entries()) {
      const dir = path.join(home, "builds", commit, "ios", "forgewatch.app")
      fs.mkdirSync(dir, { recursive: true })
      const time = new Date(Date.parse("2026-10-22T09:00:00Z") + index * 3600e3)
      fs.utimesSync(path.join(home, "builds", commit), time, time)
    }
  }

  function buildsIn(home) {
    return fs.readdirSync(path.join(home, "builds")).sort()
  }

  it.each([
    ["finds a checked build of HEAD", true],
    ["makes a new build of HEAD", false],
  ])(
    "keeps the build of HEAD and the newest other one when it %s",
    async (_name, existing) => {
      const home = tempDir("release-check-session-")
      otherBuilds(home)
      if (existing) makeIosBuild(home)
      const { deps } = baseDeps(home, CONFIG_DIR, {
        build: {
          checkArtifact: async () => ({ findings: [] }),
          buildTestApps: async ({ buildDir }) => {
            const app = path.join(buildDir, "ios", "forgewatch.app")
            fs.mkdirSync(app, { recursive: true })
            return { ok: true, platforms: { ios: { artifact: app } } }
          },
        },
      })

      const build = await checkedBuild(deps, {
        platforms: ["ios"],
        signal: new AbortController().signal,
      })

      expect(build.built).toEqual(existing ? [] : ["ios"])
      expect(buildsIn(home)).toEqual([COMMIT, NEWEST].sort())
    },
  )

  it("removes no build while a run holds the lock", async () => {
    const home = tempDir("release-check-session-")
    otherBuilds(home)
    makeIosBuild(home)
    fs.writeFileSync(
      lockPath(home),
      `${JSON.stringify({ pid: process.pid, processStart: await processStart(process.pid), mode: "run", runId: "r1" })}\n`,
    )
    const sessionDir = path.join(home, "sessions", "s3")
    fs.mkdirSync(sessionDir, { recursive: true })
    const { deps } = baseDeps(home, CONFIG_DIR)

    const code = await serveSession({ sessionDir, deviceId: "iphone-se" }, deps)

    expect(code).toBe(2)
    expect(buildsIn(home)).toEqual([OLDER, OLD, NEWEST, COMMIT].sort())
  })
})

describe("an Android session", () => {
  const IN_USE =
    "emulator-5642 is already in use, so the runner does not start forge_rc_tablet on it"

  function fakeEmulator(events, { booted, stopped }) {
    return (device) => ({
      id: device.id,
      platform: "android",
      lane: device.lane,
      serial: `emulator-${device.consolePort}`,
      restarts: 0,
      boot: async () => {
        events.push("boot")
        return booted
      },
      install: async () => ({ ok: true }),
      shutdown: async () => {
        events.push("shutdown")
        return stopped
      },
    })
  }

  it("does not stop an emulator whose serial another session holds", async () => {
    const home = tempDir("release-check-session-")
    const apk = path.join(home, "builds", COMMIT, "android", "app-release.apk")
    fs.mkdirSync(path.dirname(apk), { recursive: true })
    fs.writeFileSync(apk, "apk")
    const sessionDir = path.join(home, "sessions", "s5")
    fs.mkdirSync(sessionDir, { recursive: true })
    const events = []
    const { deps } = baseDeps(home, CONFIG_DIR, {
      createEmulator: fakeEmulator(events, {
        booted: { ok: false, refused: true, class: null, error: IN_USE },
        stopped: { ok: true },
      }),
      server: {
        create: () => ({
          bind: async () => {},
          setLaneDevice: () => {},
          startAnswering: () => {},
          close: async () => {},
        }),
      },
    })

    const code = await serveSession(
      { sessionDir, deviceId: "android-tablet" },
      deps,
    )

    expect(code).toBe(1)
    expect(events).toEqual(["boot"])
    expect(readJson(path.join(sessionDir, "state.json"))).toMatchObject({
      state: "failed",
      code: "DEVICE_BOOT_FAILED",
      error: IN_USE,
    })
    expect(fs.existsSync(lockPath(home))).toBe(false)
  })

  it("names the emulator that session down left running, instead of saying that it stopped it", async () => {
    const home = tempDir("release-check-session-")
    const sessionDir = path.join(home, "sessions", "s6")
    fs.mkdirSync(sessionDir, { recursive: true })
    const pid = endedPid()
    const record = {
      sessionId: "s6",
      sessionDir,
      pid,
      processStart: "Thu Oct 22 16:00:00 2026",
      state: "ready",
      deviceId: "android-tablet",
      udid: null,
      serial: "emulator-5642",
    }
    fs.writeFileSync(path.join(home, SESSION_FILE), JSON.stringify(record))
    const note =
      "emulator-5642 runs Pixel_9a_API_35, not forge_rc_tablet, so the runner did not stop it"
    const events = []
    const { deps, out } = baseDeps(home, CONFIG_DIR, {
      createEmulator: fakeEmulator(events, {
        booted: { ok: true },
        stopped: { ok: true, skipped: true, note },
      }),
    })

    await sessionCommand(parseArgs(["session", "down"]), deps)

    expect(events).toEqual(["shutdown"])
    const { notes } = JSON.parse(out[0])
    expect(notes).toContain(note)
    expect(notes).not.toContain("stopped android-tablet")
  })
})

describe("session try", () => {
  it("runs `settings-probe` with the session device id and the Maestro settings, and never --analyze", async () => {
    const home = tempDir("release-check-session-")
    const sessionDir = path.join(home, "sessions", "s1")
    fs.mkdirSync(sessionDir, { recursive: true })
    const artifact = makeIosBuild(home)
    fs.writeFileSync(
      path.join(home, SESSION_FILE),
      JSON.stringify({
        sessionId: "s1",
        sessionDir,
        pid: 4242,
        processStart: "Thu Oct 22 16:00:00 2026",
        state: "ready",
        deviceId: "iphone-se",
        udid: UDID,
        artifact,
        logPath: path.join(sessionDir, "server-log.jsonl"),
      }),
    )
    const children = []
    const events = []
    const configDir = configWithPorts({}, { EXPO_PUBLIC_EXPLORE_ENABLED: null })
    const { deps, out } = baseDeps(home, configDir, {
      isAlive: (pid) => pid === 4242,
      processStart: async () => "Thu Oct 22 16:00:00 2026",
      createSimulator: fakeSimulator(events),
      runChild: async (command, args) => {
        children.push({ command, args })
        return { code: 0, stdout: "", stderr: "" }
      },
      runMaestro: (options) =>
        runMaestro({
          ...options,
          runChild: async (command, args, childOptions) => {
            children.push({ command, args, env: childOptions.env })
            const flowDir = path.join(options.outputDir, "debug", "probe")
            fs.mkdirSync(flowDir, { recursive: true })
            fs.writeFileSync(
              path.join(flowDir, "commands.json"),
              JSON.stringify([
                {
                  command: { launchAppCommand: { label: "Launch the app" } },
                  metadata: { status: "COMPLETED", duration: 900, depth: 0 },
                },
              ]),
            )
            return { code: 0, stdout: "", stderr: "", timedOut: false }
          },
        }),
    })

    const code = await sessionCommand(
      parseArgs(["session", "try", "settings-probe"]),
      deps,
    )

    expect(code).toBe(0)
    const maestro = children.find((child) => child.env)
    expect(maestro.command).toBe("/opt/maestro-2.11.0/bin/maestro")
    expect(maestro.args.slice(0, 3)).toEqual(["test", "--device", UDID])
    expect(maestro.args).toContain("EXPLORE_TAB=hidden")
    expect(maestro.args.at(-1)).toBe(
      path.join(JOURNEYS_DIR, "settings-probe.yaml"),
    )
    expect(maestro.args.join(" ")).not.toMatch(/--analyze|cloud/)
    expect(maestro.env).toMatchObject({
      MAESTRO_CLI_NO_ANALYTICS: "1",
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
      MAESTRO_DISABLE_UPDATE_CHECK: "true",
    })
    // The fresh install of a run's iOS attempt comes first (U7).
    expect(children[0].args).toEqual([
      "simctl",
      "uninstall",
      UDID,
      "org.jesusfilm.forgewatch",
    ])
    expect(events).toEqual([["install", artifact]])
    const printed = JSON.parse(out[0])
    expect(printed).toMatchObject({
      journey: "settings-probe",
      deviceId: "iphone-se",
      passed: true,
      steps: [
        {
          label: "Launch the app",
          command: "launchAppCommand",
          status: "COMPLETED",
        },
      ],
    })
    expect(
      fs.readFileSync(path.join(sessionDir, "session.log"), "utf8"),
    ).toMatch(/try settings-probe passed/)
  })
})

describe("session down", () => {
  function deadSession(home, logLines) {
    const sessionDir = path.join(home, "sessions", "s2")
    fs.mkdirSync(sessionDir, { recursive: true })
    const pid = endedPid()
    const record = {
      sessionId: "s2",
      sessionDir,
      pid,
      processStart: "Thu Oct 22 16:00:00 2026",
      state: "ready",
      deviceId: "iphone-se",
      udid: UDID,
      logPath: path.join(sessionDir, "server-log.jsonl"),
    }
    fs.writeFileSync(path.join(home, SESSION_FILE), JSON.stringify(record))
    fs.writeFileSync(
      lockPath(home),
      `${JSON.stringify({ pid, processStart: record.processStart, mode: "session", runId: "s2" })}\n`,
    )
    fs.writeFileSync(
      record.logPath,
      logLines.map((line) => JSON.stringify(line)).join("\n"),
    )
  }

  function forwarded(query) {
    const body = JSON.stringify({ query, variables: {}, operationName: null })
    return {
      ts: "2026-10-22T03:00:00.000Z",
      port: 38211,
      lane: "ios",
      deviceId: "iphone-se",
      family: "v6",
      method: "POST",
      path: "/api/graphql",
      route: "forwarded",
      forwardedBody: body,
      forwardedSha256: sha256(body),
    }
  }

  async function down(home) {
    const events = []
    const { deps, out } = baseDeps(home, CONFIG_DIR, {
      createSimulator: fakeSimulator(events),
    })
    const code = await sessionCommand(parseArgs(["session", "down"]), deps)
    return { code, printed: JSON.parse(out[0]), events }
  }

  it("fails when the session log has a forwarded write, and still stops the device and the lock", async () => {
    const home = tempDir("release-check-session-")
    deadSession(home, [
      forwarded(
        'mutation { submitFeedback(input: { message: "x" }) { accepted } }',
      ),
    ])

    const { code, printed, events } = await down(home)

    expect(code).toBe(1)
    expect(printed.logCheck.passed).toBe(false)
    expect(printed.logCheck.findings.map((item) => item.code)).toContain(
      "FORWARDED_MUTATION",
    )
    expect(events).toEqual([["shutdown", UDID]])
    expect(fs.existsSync(lockPath(home))).toBe(false)
    expect(fs.existsSync(path.join(home, SESSION_FILE))).toBe(false)
  })

  it("passes when the session log has only forwarded reads", async () => {
    const home = tempDir("release-check-session-")
    deadSession(home, [forwarded('query { videoBySlug(slug: "x") { id } }')])

    const { code, printed } = await down(home)

    expect(code).toBe(0)
    expect(printed.logCheck).toMatchObject({ passed: true, findings: [] })
  })
})
