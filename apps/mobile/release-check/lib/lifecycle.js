"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, AbortSignal, clearTimeout, module, require, setTimeout */
// The run lifecycle (U6, KTD13, R38): the run, status, stop, recover, and
// setup modes. Every run that passed its refusal checks ends through one end
// path: stop the children, the server, and the owned devices, then report.

const childProcess = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const readline = require("node:readline")

const { EXIT } = require("./contract")
const { CONFIG_DIR, JOURNEYS_DIR, REPO_ROOT, readJson } = require("./lists")
const lockLib = require("./lock")
const plan = require("./plan")
const proc = require("./proc")
const { DEFAULT_KEEP, applyRetention } = require("./report/retention")
const {
  MARKDOWN_FILE,
  REPORT_FILE,
  SUMMARY_FILE,
  SummaryError,
  buildSummary,
  renderReport,
  writeSummary,
} = require("./report/summary")
const runFolder = require("./runFolder")

const CLI_PATH = path.resolve(__dirname, "..", "cli.mjs")
const MINUTE = 60_000
// One place for every time limit (KTD13). A limit ends the run as `timeout`.
const TIME_LIMITS = Object.freeze({
  setup: 90 * MINUTE,
  building: 45 * MINUTE,
  checking: 5 * MINUTE,
  probing: 20 * MINUTE,
  journeys: 4 * 60 * MINUTE,
  speed: 45 * MINUTE,
  logcheck: 5 * MINUTE,
  run: 6 * 60 * MINUTE,
})
const HEARTBEAT_MS = 15_000
const STOP_GRACE_MS = 10_000
const STOP_WAIT_MS = 2 * MINUTE
const POLL_MS = 1000
const KEEP_BUILDS = 2
const GIT_TIMEOUT_MS = 2 * MINUTE
const GIT_OUTPUT_BYTES = 32 * 1024 * 1024
const ADMIN_SCHEMA_PATH = "apps/admin/schema.graphql"
const ANDROID_ARTIFACT = path.join("android", "app-release.apk")

class LifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LifecycleError"
    this.code = code
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

// ── Dependencies ─────────────────────────────────────────────────────

function notBuilt(phase) {
  return async () => {
    throw new LifecycleError(
      "phase_not_built",
      `the ${phase} phase is not built yet`,
    )
  }
}

function askLine(question) {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close()
      resolve(answer)
    })
  })
}

/** Starts `command` in its own session with its output in `logFile`. */
function spawnDetached(command, args, { cwd, env, logFile }) {
  const fd = fs.openSync(logFile, "a")
  try {
    const child = childProcess.spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    })
    child.unref()
    return { pid: child.pid }
  } finally {
    fs.closeSync(fd)
  }
}

async function gitText(repoRoot, env, args) {
  const result = await proc.run("git", args, {
    cwd: repoRoot,
    env: { PATH: env.PATH ?? "/usr/bin:/bin", HOME: env.HOME ?? "" },
    timeoutMs: GIT_TIMEOUT_MS,
    tailBytes: GIT_OUTPUT_BYTES,
  })
  if (result.code !== 0) {
    throw new LifecycleError(
      "git_failed",
      `git ${args.join(" ")} failed: ${(result.stderr || result.error || "").trim()}`,
    )
  }
  return result.stdout
}

function readConfig(configDir) {
  const read = (name) => readJson(path.join(configDir, name))
  return {
    devices: read("devices.json"),
    settings: read("test-settings.json"),
    operations: read("operations.json"),
    searchAnswers: read("search-answers.json"),
    notTested: read("not-tested.json"),
  }
}

function listDigestsIn(configDir) {
  return Object.fromEntries(
    fs
      .readdirSync(configDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => [
        `config/${name}`,
        sha256(fs.readFileSync(path.join(configDir, name))),
      ]),
  )
}

const MERGED_GROUPS = [
  "git",
  "setup",
  "devices",
  "host",
  "admin",
  "lock",
  "gate",
  "server",
  "build",
  "phases",
  "report",
  "limits",
]

// The real layers. A test passes `overrides`, and each group above merges
// one level deep, so a test replaces one function and keeps the rest.
function createDeps(overrides = {}) {
  const env = overrides.env ?? process.env
  const worktree = () => require("./testBuild/worktree")
  const home = overrides.home ?? worktree().runnerHome(env)
  const repoRoot = overrides.repoRoot ?? REPO_ROOT
  const configDir = overrides.configDir ?? CONFIG_DIR
  const inventory = () => require("./devices/inventory")
  const gate = () => require("./devices/gate")
  const base = {
    env,
    home,
    repoRoot,
    configDir,
    config: overrides.config ?? readConfig(configDir),
    listDigests: () => listDigestsIn(configDir),
    journeyIds: () => plan.journeyIdsIn(overrides.journeysDir ?? JOURNEYS_DIR),
    cliPath: CLI_PATH,
    nodePath: process.execPath,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    stdin: process.stdin,
    ask: askLine,
    now: () => Date.now(),
    randomHex: () => crypto.randomBytes(2).toString("hex"),
    pid: process.pid,
    signals: process,
    kill: (pid, signal) => process.kill(pid, signal),
    isAlive: lockLib.isAlive,
    heartbeatMs: HEARTBEAT_MS,
    graceMs: STOP_GRACE_MS,
    stopWaitMs: STOP_WAIT_MS,
    pollMs: POLL_MS,
    limits: TIME_LIMITS,
    macTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    git: {
      head: () => worktree().resolveCommit({ repoRoot, env }),
      dirty: () => worktree().dirtyBuildInputs({ repoRoot, env }),
      objectId: async (commit, relPath) =>
        (
          await gitText(repoRoot, env, ["rev-parse", `${commit}:${relPath}`])
        ).trim(),
      show: (commit, relPath) =>
        gitText(repoRoot, env, ["show", `${commit}:${relPath}`]),
    },
    buildInputs: () => worktree().BUILD_INPUTS,
    setup: {
      check: () =>
        require("./devices/setup").runSetup({ check: true, sourceEnv: env }),
      apply: () =>
        require("./devices/setup").runSetup({ check: false, sourceEnv: env }),
    },
    setupCommand: (command) => require("./devices/setup").setupCommand(command),
    devices: {
      list: () => inventory().listInventory({ env: inventory().toolEnv(env) }),
      stopOwned: (current) =>
        inventory().stopOwnedDevices(current, {
          env: inventory().toolEnv(env),
        }),
      runningForeign: (current) => inventory().runningForeign(current),
    },
    lanes: () =>
      Object.entries(inventory().loadPorts().lanes).map(([lane, port]) => ({
        lane,
        port,
      })),
    host: {
      sample: () => gate().sampleHost({ env: inventory().toolEnv(env) }),
      diskFree: plan.diskFree,
    },
    admin: {
      preflight: () =>
        plan.preflightAdmin({
          url: require("./server/server").DEFAULT_UPSTREAM_URL,
        }),
    },
    lock: {
      inspect: () => lockLib.inspectLock(home),
      acquire: (options) => lockLib.acquireLock(home, options),
    },
    gate: {
      planCapacity: (input) => gate().planCapacity(input),
      create: (gateConfig) =>
        gate().createGate({ gate: gateConfig, env: inventory().toolEnv(env) }),
    },
    server: {
      create: (options) =>
        require("./server/server").createReadOnlyServer(options),
    },
    build: {
      buildTestApps: (options) => worktree().buildTestApps(options),
      checkArtifact: (file, options) =>
        require("./testBuild/artifactCheck").checkArtifact(file, options),
    },
    phases: {
      ...require("./journeys/phases").createJourneyPhases({
        journeysDir: overrides.journeysDir ?? JOURNEYS_DIR,
        configDir,
      }),
      speed: notBuilt("speed"),
    },
    logCheck: (logPath, options) =>
      require("./server/logCheck").checkLog(logPath, options),
    report: { buildSummary, writeSummary, renderReport, applyRetention },
    stopChildren: () => proc.stopAll(),
    caffeinate: (pid, timeoutMs) =>
      proc.run("/usr/bin/caffeinate", ["-i", "-w", String(pid)], {
        env: { PATH: "/usr/bin:/bin" },
        timeoutMs,
      }),
    spawnDetached,
  }
  const deps = { ...base, ...overrides }
  for (const group of MERGED_GROUPS) {
    deps[group] = { ...base[group], ...overrides[group] }
  }
  return deps
}

// ── Refusals ─────────────────────────────────────────────────────────

function printRefusals(deps, refusals) {
  deps.err(
    [
      "release-check refused: the run did not start.",
      ...refusals.map((item) => `- ${item.code}: ${item.message}`),
    ].join("\n"),
  )
}

// A detached child has no terminal, so its refusal goes into status.json
// for `status` to show. A refusal writes no report (KTD13).
function refuse(deps, refusals, childRunId = null) {
  printRefusals(deps, refusals)
  if (childRunId) {
    try {
      const runDir = runFolder.runDirOf(deps.home, childRunId)
      fs.mkdirSync(runDir, { recursive: true })
      runFolder.writeJson(path.join(runDir, runFolder.STATUS_FILE), {
        schemaVersion: 1,
        runId: childRunId,
        pid: deps.pid,
        startedAt: null,
        phase: "refused",
        heartbeatAt: new Date(deps.now()).toISOString(),
        stopReason: null,
        result: null,
        exitCode: EXIT.refused,
        refusals,
      })
    } catch (error) {
      deps.err(
        `release-check: cannot write the refusal status: ${error.message}`,
      )
    }
  }
  return EXIT.refused
}

function refuseMode(deps, message) {
  deps.err(`release-check refused: ${message}.`)
  return EXIT.refused
}

function lockHeldRefusal(lock) {
  return {
    code: "LOCK_HELD",
    message: `Another release check holds the lock (mode ${lock.mode}, pid ${lock.pid}${lock.runId ? `, run ${lock.runId}` : ""}).`,
  }
}

// ── run ──────────────────────────────────────────────────────────────

/** The child's command line: the same run, with consent and the run id. */
function childArgs(flags, { runId, commit }) {
  const args = ["run", "--yes", "--expect-commit", commit, "--run-id", runId]
  if (flags["allow-setup"]) args.push("--allow-setup")
  if (flags.journey) args.push("--journey", flags.journey.join(","))
  if (flags.device) args.push("--device", flags.device.join(","))
  if (flags.platform) args.push("--platform", flags.platform)
  if (flags["skip-speed-pass"]) args.push("--skip-speed-pass")
  if (flags["reuse-build"]) args.push("--reuse-build")
  return args
}

function launchDetached(deps, flags, pre) {
  const runId = runFolder.newRunId(new Date(deps.now()), deps.randomHex())
  const runDir = runFolder.runDirOf(deps.home, runId)
  fs.mkdirSync(runDir, { recursive: true })
  deps.spawnDetached(
    deps.nodePath,
    [deps.cliPath, ...childArgs(flags, { runId, commit: pre.commit })],
    {
      cwd: deps.repoRoot,
      env: deps.env,
      logFile: path.join(runDir, runFolder.RUNNER_LOG),
    },
  )
  deps.out(JSON.stringify({ runId, runDir }))
  return EXIT.passed
}

/** The mode handler for `run`: refusal checks, consent, then the run. */
async function runCommand(command, deps) {
  const flags = command.flags
  const childRunId = flags["run-id"] ?? null
  if (flags.yes !== true && !deps.stdin.isTTY) {
    return refuse(
      deps,
      [
        {
          code: "NO_CONSENT",
          message:
            "`run` needs `--yes` when stdin is not a terminal. Run `plan` first, then use the run command that it shows.",
        },
      ],
      childRunId,
    )
  }
  const pre = await plan.gatherPreflight(deps, { flags, forRun: true })
  if (flags.yes !== true) {
    deps.out(plan.formatPlan(pre))
    if (pre.refusals.length > 0) {
      deps.err("release-check refused: the run did not start; see above.")
      return EXIT.refused
    }
    const answer = await deps.ask("Start? (y/N) ")
    if (!/^y(es)?$/i.test(String(answer).trim())) {
      deps.out("release-check: the run did not start.")
      return EXIT.refused
    }
  }
  if (pre.refusals.length > 0) return refuse(deps, pre.refusals, childRunId)
  if (flags.detach) return launchDetached(deps, flags, pre)
  const runId =
    childRunId ?? runFolder.newRunId(new Date(deps.now()), deps.randomHex())
  return executeRun(deps, { flags, pre, runId, childRunId })
}

function finding(code, message) {
  return { code, message, setting: null, file: null, deviceId: null }
}

function iosArtifactIn(buildDir) {
  const dir = path.join(buildDir, "ios")
  if (!fs.existsSync(dir)) return null
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith(".app"))
  return apps.length === 1 ? path.join(dir, apps[0]) : null
}

function artifactPath(buildDir, platform) {
  if (platform === "ios") return iosArtifactIn(buildDir)
  const apk = path.join(buildDir, ANDROID_ARTIFACT)
  return fs.existsSync(apk) ? apk : null
}

// Keeps the build of this commit and the newest other one, by folder time.
function pruneBuilds(home, keepCommit, now) {
  const buildsDir = path.join(home, "builds")
  if (!fs.existsSync(buildsDir)) return
  const current = path.join(buildsDir, keepCommit)
  if (fs.existsSync(current)) {
    const time = new Date(now)
    fs.utimesSync(current, time, time)
  }
  const others = fs
    .readdirSync(buildsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== keepCommit)
    .map((entry) => ({
      dir: path.join(buildsDir, entry.name),
      mtimeMs: fs.statSync(path.join(buildsDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const entry of others.slice(KEEP_BUILDS - 1)) {
    fs.rmSync(entry.dir, { recursive: true, force: true })
  }
}

function toolVersions(observed) {
  const versions = { node: process.versions.node }
  for (const [key, value] of Object.entries(observed ?? {})) {
    if (key === "hostTimezone" || key === "simulatorHardwareKeyboard") continue
    if (value !== null && value !== undefined && String(value) !== "") {
      versions[key] = String(value)
    }
  }
  return versions
}

function devicePins(devicesConfig, devices, observed = {}) {
  return Object.fromEntries(
    devices.map((device) => {
      const own =
        device.platform === "ios"
          ? {
              deviceType: device.deviceType,
              runtime: device.runtime,
              observedRuntime: observed.iosRuntime ?? null,
              observedHardwareKeyboard:
                observed.simulatorHardwareKeyboard ?? null,
            }
          : {
              profile: device.profile,
              image: device.image,
              observedImageRevision: observed.androidImageRevision ?? null,
              observedEmulator: observed.emulator ?? null,
            }
      return [device.id, { ...devicesConfig.pins, ...own }]
    }),
  )
}

// The started part of a run (KTD13): it takes the lock and the ports, and
// from the bind on, every exit goes through `endRun` (R38).
async function executeRun(deps, { flags, pre, runId, childRunId }) {
  const { commit, selection } = pre
  const startedMs = deps.now()
  const startedAt = new Date(startedMs).toISOString()
  const runDir = runFolder.runDirOf(deps.home, runId)
  const logPath = path.join(runDir, runFolder.SERVER_LOG)
  const config = deps.config

  const lock = await deps.lock.acquire({ mode: "run", runId, pid: deps.pid })
  if (!lock.ok) return refuse(deps, [lockHeldRefusal(lock.lock)], childRunId)

  const createdDir = !fs.existsSync(runDir)
  const state = {
    stopReason: null,
    completed: [],
    checks: { build: null, log: null, screens: null, settingsProbe: null },
    attempts: [],
    restarts: [],
    staleKnownBugs: [],
    proposedActions: [],
    journeyRefusals: null,
    logRefusals: null,
    speed: null,
    artifacts: {},
    serverClosed: false,
  }
  const runAbort = new AbortController()
  let notifyStop
  const stopped = new Promise((resolve) => {
    notifyStop = resolve
  })
  let recorder = null
  function requestStop(reason, detail = null) {
    if (state.stopReason) return
    state.stopReason = reason
    recorder?.event({ type: "stop", reason, detail })
    runAbort.abort()
    notifyStop(reason)
  }

  let server
  let adminSchemaSdl
  try {
    fs.mkdirSync(runDir, { recursive: true })
    adminSchemaSdl = await deps.git.show(commit, ADMIN_SCHEMA_PATH)
    server = deps.server.create({
      lanes: deps.lanes(),
      operations: config.operations,
      searchAnswers: config.searchAnswers,
      adminSchemaSdl,
      logPath,
      onUpstreamUnavailable: () =>
        requestStop("upstream_unavailable", "5 forwarded requests in a row"),
    })
    await server.bind()
  } catch (error) {
    lock.release()
    if (createdDir) fs.rmSync(runDir, { recursive: true, force: true })
    const code = error.code === "PORT_TAKEN" ? "PORT_TAKEN" : "RUN_START_FAILED"
    return refuse(deps, [{ code, message: `${error.message}.` }], childRunId)
  }

  recorder = runFolder.createRunRecorder(runDir, {
    runId,
    pid: deps.pid,
    startedAt,
    now: deps.now,
    heartbeatMs: deps.heartbeatMs,
  })
  const onSigterm = () => requestStop("aborted", "SIGTERM")
  const onSigint = () => requestStop("aborted", "SIGINT")
  deps.signals.on("SIGTERM", onSigterm)
  deps.signals.on("SIGINT", onSigint)
  const runTimer = setTimeout(
    () => requestStop("timeout", "run"),
    deps.limits.run,
  )
  const log = (text) =>
    deps.out(`[release-check ${new Date(deps.now()).toISOString()}] ${text}`)
  const identity = {
    runId,
    commit,
    scope: selection.scope,
    startedAt,
    inputDigests: {},
    listDigests: {},
    toolVersions: toolVersions(pre.setup.observed),
    devicePins: devicePins(
      config.devices,
      selection.devices,
      pre.setup.observed,
    ),
    macTimeZone: deps.macTimeZone(),
  }

  // The schema needs 64 hex characters, so each git object id is hashed once
  // more. A path that the commit lacks is left out, not the whole record.
  async function recordIdentity() {
    try {
      identity.listDigests = deps.listDigests()
    } catch (error) {
      recorder.event({ type: "identity_failed", message: error.message })
    }
    await Promise.all(
      deps.buildInputs().map(async (rel) => {
        try {
          identity.inputDigests[rel] = sha256(
            await deps.git.objectId(commit, rel),
          )
        } catch (error) {
          recorder.event({ type: "identity_failed", message: error.message })
        }
      }),
    )
  }

  // Each phase runs under the run signal and its own time limit. After a
  // stop, it gets a short grace to record what it has, then the end path runs.
  async function phase(name, body) {
    if (state.stopReason) return
    recorder.phase(name)
    log(`phase ${name}`)
    const phaseAbort = new AbortController()
    const signal = AbortSignal.any([runAbort.signal, phaseAbort.signal])
    const limit = setTimeout(() => {
      requestStop("timeout", name)
      phaseAbort.abort()
    }, deps.limits[name])
    const work = Promise.resolve().then(() => body(signal))
    work.catch(() => {})
    let graceTimer = null
    try {
      const outcome = await Promise.race([
        work.then(() => "done"),
        stopped.then(() => "stopped"),
      ])
      if (outcome === "stopped") {
        await Promise.race([
          work.catch(() => {}),
          new Promise((resolve) => {
            graceTimer = setTimeout(resolve, deps.graceMs)
          }),
        ])
      }
    } finally {
      clearTimeout(limit)
      clearTimeout(graceTimer)
    }
    if (!state.stopReason) {
      state.completed.push(name)
      recorder.phaseDone(name)
    }
  }

  let gate = null
  const buildDir = path.join(deps.home, "builds", commit)
  function phaseContext(signal) {
    gate ??= deps.gate.create(config.devices.gate)
    return {
      signal,
      runId,
      runDir,
      commit,
      home: deps.home,
      repoRoot: deps.repoRoot,
      env: deps.env,
      selection,
      settings: config.settings,
      devicesConfig: config.devices,
      buildDir,
      artifacts: state.artifacts,
      server,
      gate,
      admit: async (device) => {
        const admitted = await gate.admit(device, { signal })
        if (!admitted.admitted && admitted.stopReason === "host_overload") {
          requestStop("host_overload", admitted.message)
        }
        return admitted
      },
      release: (device) => gate.release(device),
      stop: (reason, detail) => requestStop(reason, detail),
      event: (fields) => recorder.event(fields),
    }
  }

  async function checkOne(file) {
    try {
      const result = await deps.build.checkArtifact(file, {
        settings: config.settings,
        env: deps.env,
      })
      return result.findings
    } catch (error) {
      if (error.name !== "ArtifactCheckRefusal") throw error
      return [
        finding(
          "BUILD_CHECK_REFUSED",
          `The build check cannot read ${path.basename(file)}: ${error.message}.`,
        ),
      ]
    }
  }

  async function reusableArtifacts() {
    const artifacts = {}
    for (const platform of selection.platforms) {
      const file = artifactPath(buildDir, platform)
      if (!file || (await checkOne(file)).length > 0) return null
      artifacts[platform] = file
    }
    return artifacts
  }

  async function closeServer() {
    if (state.serverClosed) return
    state.serverClosed = true
    await server.close()
  }

  async function runPhases() {
    if (pre.setup.needed && flags["allow-setup"]) {
      await phase("setup", async () => {
        const result = await deps.setup.apply()
        if (!result.ready) {
          recorder.event({
            type: "setup_failed",
            problems: result.problems.map((item) => item.code),
          })
          requestStop("setup_failed")
        }
      })
    }
    await phase("building", async (signal) => {
      const reused = flags["reuse-build"] ? await reusableArtifacts() : null
      if (reused) {
        recorder.event({ type: "build_reused", commit })
        Object.assign(state.artifacts, reused)
      } else {
        fs.rmSync(buildDir, { recursive: true, force: true })
        const result = await deps.build.buildTestApps({
          repoRoot: deps.repoRoot,
          commit,
          buildDir,
          settings: config.settings,
          platforms: selection.platforms,
          home: deps.home,
          parentEnv: deps.env,
          signal,
        })
        if (!result.ok) {
          if (!state.stopReason) {
            recorder.event({ type: "build_failed", step: result.failedStep })
          }
          requestStop("build_failed", result.failedStep)
          return
        }
        for (const platform of selection.platforms) {
          state.artifacts[platform] = result.platforms[platform].artifact
        }
      }
      pruneBuilds(deps.home, commit, deps.now())
    })
    await phase("checking", async () => {
      const findings = []
      for (const platform of selection.platforms) {
        findings.push(...(await checkOne(state.artifacts[platform])))
      }
      state.checks.build = { passed: findings.length === 0, findings }
      if (findings.length > 0) requestStop("build_check_failed")
    })
    if (!state.stopReason) server.startAnswering()
    await phase("probing", async (signal) => {
      const result = await deps.phases.probing(phaseContext(signal))
      state.checks.settingsProbe = {
        passed: result.passed === true,
        findings: result.findings ?? [],
      }
      if (result.passed !== true) requestStop("probe_failed")
    })
    await phase("journeys", async (signal) => {
      const result = await deps.phases.journeys(phaseContext(signal))
      state.attempts = result.attempts ?? []
      state.restarts = result.restarts ?? []
      state.staleKnownBugs = result.staleKnownBugs ?? []
      state.proposedActions = result.proposedActions ?? []
      if (result.screens !== undefined) state.checks.screens = result.screens
      if (result.rateLimitRefusals) {
        state.journeyRefusals = result.rateLimitRefusals
      }
      if (result.stopReason) requestStop(result.stopReason)
    })
    if (!flags["skip-speed-pass"]) {
      await phase("speed", async (signal) => {
        server.setSpeedMode(true)
        try {
          state.speed = await deps.phases.speed(phaseContext(signal))
        } finally {
          server.setSpeedMode(false)
        }
      })
    }
    await phase("logcheck", async () => {
      await closeServer()
      const result = deps.logCheck(logPath, {
        operations: config.operations,
        expectedDevices: selection.devices.map((device) => device.id),
      })
      state.checks.log = {
        passed: result.passed,
        findings: result.findings,
        perDevice: result.perDevice,
        routes: result.routes,
      }
      state.logRefusals = result.rateLimitRefusals
    })
  }

  async function endStep(name, fn) {
    try {
      return await fn()
    } catch (error) {
      recorder.event({
        type: "end_step_failed",
        step: name,
        message: error.message,
      })
      return undefined
    }
  }

  // R38: the same end for a normal end, an error, a signal, a time limit,
  // and every stop reason.
  async function endRun() {
    clearTimeout(runTimer)
    requestStop("completed")
    recorder.phase("ending")
    log(`ending (${state.stopReason})`)
    await endStep("stop_children", () => deps.stopChildren())
    await endStep("close_server", closeServer)
    const stats = (await endStep("server_stats", () => server.stats())) ?? {}
    await endStep("stop_devices", async () => {
      const results = await deps.devices.stopOwned(await deps.devices.list())
      for (const item of results ?? []) {
        if (!item.ok) recorder.event({ type: "device_not_stopped", ...item })
      }
    })
    const refusals =
      state.journeyRefusals ??
      (state.logRefusals ?? stats.rateLimitRefusals ?? []).map((item) => ({
        ts: item.ts,
        field: item.field,
        deviceId: item.deviceId ?? null,
        journey: null,
        attempt: null,
      }))
    const fullIdentity = {
      ...identity,
      endedAt: new Date(deps.now()).toISOString(),
    }
    let summary = await endStep("build_summary", async () => {
      try {
        return deps.report.buildSummary({
          identity: fullIdentity,
          outcome: {
            stopReason: state.stopReason,
            completedPhases: [...state.completed],
          },
          attempts: state.attempts,
          checks: state.checks,
          server: { routes: stats.routes ?? {}, rateLimitRefusals: refusals },
          notTested: config.notTested.entries ?? [],
          staleKnownBugs: state.staleKnownBugs,
          restarts: state.restarts,
          speed: state.speed,
          proposedActions: state.proposedActions,
        })
      } catch (error) {
        if (!(error instanceof SummaryError)) throw error
        recorder.event({ type: "summary_invalid", errors: error.errors })
        return deps.report.buildSummary({
          identity: fullIdentity,
          outcome: {
            stopReason: "runner_error",
            completedPhases: [...state.completed],
          },
        })
      }
    })
    if (summary) {
      const written = await endStep("write_report", () => {
        deps.report.writeSummary(runDir, summary)
        deps.report.renderReport(runDir)
        return true
      })
      if (!written) summary = null
      await endStep("retention", () =>
        deps.report.applyRetention(deps.home, DEFAULT_KEEP),
      )
    }
    const exitCode = summary ? summary.exitCode : EXIT.failed
    deps.signals.off("SIGTERM", onSigterm)
    deps.signals.off("SIGINT", onSigint)
    recorder.stopHeartbeat()
    recorder.write({
      phase: "ended",
      stopReason: summary?.stopReason ?? state.stopReason,
      result: summary?.result ?? null,
      exitCode,
    })
    lock.release()
    log(
      summary
        ? `result ${summary.result} (stop reason ${summary.stopReason}). Report: ${path.join(runDir, REPORT_FILE)}. Summary: ${path.join(runDir, MARKDOWN_FILE)}.`
        : "the runner could not write the report; see events.jsonl.",
    )
    return exitCode
  }

  try {
    void Promise.resolve(
      deps.caffeinate(deps.pid, deps.limits.run + 30 * MINUTE),
    ).catch(() => {})
    runFolder.writeRunFile(runDir, {
      runId,
      commit,
      scope: selection.scope,
      devices: selection.devices.map((device) => device.id),
      startedAt,
    })
    recorder.write({})
    recorder.startHeartbeat()
    log(`run ${runId} started for commit ${commit} (${runDir}).`)
    await recordIdentity()
    await runPhases()
  } catch (error) {
    recorder.event({ type: "error", message: error.message })
    requestStop("runner_error", error.message)
  }
  return endRun()
}

// ── status, stop, recover, setup ────────────────────────────────────

function lockSummary(lock) {
  return {
    state: lock.state,
    reason: lock.reason,
    mode: lock.lock?.mode ?? null,
    pid: lock.lock?.pid ?? null,
    runId: lock.lock?.runId ?? null,
  }
}

function existing(file) {
  return fs.existsSync(file) ? file : null
}

function describeRun(deps, runDir, lock) {
  const status = runFolder.readStatus(runDir)
  const summary = runFolder.readJsonOrNull(path.join(runDir, SUMMARY_FILE))
  const runId = path.basename(runDir)
  const pid = status?.pid ?? null
  let pidState = null
  if (lock.lock?.runId === runId) {
    pidState = lock.state === "held" ? "running" : "ended"
  } else if (pid !== null) {
    pidState = deps.isAlive(pid) && !summary ? "running" : "ended"
  }
  const heartbeat = Date.parse(status?.heartbeatAt ?? "")
  return {
    runId,
    runDir,
    phase: status?.phase ?? (summary ? "ended" : "starting"),
    heartbeatAgeSec: Number.isFinite(heartbeat)
      ? Math.max(0, Math.round((deps.now() - heartbeat) / 1000))
      : null,
    pid,
    pidState,
    result: summary?.result ?? null,
    stopReason: summary?.stopReason ?? status?.stopReason ?? null,
    exitCode: summary?.exitCode ?? status?.exitCode ?? null,
    report: existing(path.join(runDir, REPORT_FILE)),
    summaryMd: existing(path.join(runDir, MARKDOWN_FILE)),
    refusals: status?.refusals ?? [],
  }
}

function statusText(lock, run) {
  const lines = []
  const holder = lock.lock
    ? ` (mode ${lock.lock.mode}, pid ${lock.lock.pid}${lock.lock.runId ? `, run ${lock.lock.runId}` : ""})`
    : ""
  lines.push(
    `Lock: ${lock.state}${holder}${lock.reason ? `, ${lock.reason}` : ""}.`,
  )
  if (!run) {
    lines.push("No run folder exists yet.")
    return lines.join("\n")
  }
  lines.push(`Newest run: ${run.runId} (${run.runDir}).`)
  const beat =
    run.heartbeatAgeSec === null
      ? ""
      : `, heartbeat ${run.heartbeatAgeSec} s ago`
  const pid = run.pid === null ? "" : `, runner pid ${run.pid} ${run.pidState}`
  lines.push(`Phase: ${run.phase}${beat}${pid}.`)
  for (const item of run.refusals) {
    lines.push(`Refused: ${item.code}: ${item.message}`)
  }
  if (run.result) {
    lines.push(`Result: ${run.result} (stop reason ${run.stopReason}).`)
  }
  if (run.report) lines.push(`Report: ${run.report}`)
  if (run.summaryMd) lines.push(`Summary: ${run.summaryMd}`)
  return lines.join("\n")
}

/** The mode handler for `status [--json]`; it only reads. */
async function statusCommand(command, deps) {
  const lock = await deps.lock.inspect()
  const runDir = runFolder.newestRunDir(deps.home)
  const run = runDir ? describeRun(deps, runDir, lock) : null
  deps.out(
    command.flags.json
      ? JSON.stringify(
          { mode: "status", lock: lockSummary(lock), run },
          null,
          2,
        )
      : statusText(lock, run),
  )
  return EXIT.passed
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** The mode handler for `stop`: SIGTERM to the verified runner, then wait. */
async function stopCommand(command, deps) {
  const lock = await deps.lock.inspect()
  if (lock.state === "free") {
    return refuseMode(
      deps,
      "no release check holds the lock, so no run is going",
    )
  }
  if (lock.state === "stale") {
    return refuseMode(
      deps,
      `the lock's runner (pid ${lock.lock?.pid ?? "unknown"}) ended before its end steps; run \`recover\``,
    )
  }
  if (lock.lock.mode !== "run" || !lock.lock.runId) {
    return refuseMode(
      deps,
      `the lock holder is \`${lock.lock.mode}\`, not a run`,
    )
  }
  const runDir = runFolder.runDirOf(deps.home, lock.lock.runId)
  const markdown = path.join(runDir, MARKDOWN_FILE)
  try {
    deps.kill(lock.lock.pid, "SIGTERM")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  deps.out(
    `release-check: sent SIGTERM to run ${lock.lock.runId} (pid ${lock.lock.pid}); waiting for its report.`,
  )
  const end = deps.now() + deps.stopWaitMs
  while (!fs.existsSync(markdown) && deps.now() < end) {
    await delay(deps.pollMs)
  }
  if (!fs.existsSync(markdown)) {
    deps.err(
      `release-check: the run did not write ${markdown} within ${Math.round(deps.stopWaitMs / 1000)} s.`,
    )
    return EXIT.failed
  }
  deps.out(`release-check: the run ended. Summary: ${markdown}`)
  return EXIT.passed
}

/** The mode handler for `recover`: reports an orphan run as `runner_killed`. */
async function recoverCommand(command, deps) {
  const taken = await deps.lock.acquire({ mode: "recover", pid: deps.pid })
  if (!taken.ok) {
    return refuseMode(
      deps,
      `a live \`${taken.lock.mode}\` (pid ${taken.lock.pid}) holds the lock; use \`stop\` to end a run`,
    )
  }
  try {
    const orphan = taken.replaced
    if (!orphan || orphan.mode !== "run" || !orphan.runId) {
      deps.out(
        orphan
          ? `release-check recover: removed the stale ${orphan.mode} lock of pid ${orphan.pid}.`
          : "release-check recover: no stale lock, so there is no orphan run.",
      )
      return EXIT.passed
    }
    const runDir = runFolder.runDirOf(deps.home, orphan.runId)
    if (fs.existsSync(path.join(runDir, SUMMARY_FILE))) {
      deps.out(
        `release-check recover: run ${orphan.runId} wrote its summary; removed its stale lock.`,
      )
      return EXIT.passed
    }
    await deps.devices.stopOwned(await deps.devices.list())
    const run = runFolder.readRunFile(runDir)
    if (!run) {
      deps.out(
        `release-check recover: stopped the runner's devices. Run ${orphan.runId} left no run.json, so no report can be written.`,
      )
      return EXIT.passed
    }
    const summary = deps.report.buildSummary({
      identity: {
        runId: run.runId,
        commit: run.commit,
        scope: run.scope,
        startedAt: run.startedAt,
        endedAt: new Date(deps.now()).toISOString(),
        macTimeZone: deps.macTimeZone(),
      },
      outcome: {
        stopReason: "runner_killed",
        completedPhases: runFolder.completedPhasesFrom(
          runFolder.readEvents(runDir),
        ),
      },
    })
    deps.report.writeSummary(runDir, summary)
    deps.report.renderReport(runDir)
    deps.report.applyRetention(deps.home, DEFAULT_KEEP)
    const status = runFolder.readStatus(runDir) ?? {}
    runFolder.writeJson(path.join(runDir, runFolder.STATUS_FILE), {
      ...status,
      phase: "ended",
      stopReason: summary.stopReason,
      result: summary.result,
      exitCode: summary.exitCode,
    })
    deps.out(
      `release-check recover: wrote the report of run ${orphan.runId}. Summary: ${path.join(runDir, MARKDOWN_FILE)}`,
    )
    return EXIT.passed
  } finally {
    taken.release()
  }
}

/** The mode handler for `setup [--check]`; only a setup that writes takes the lock. */
async function setupMode(command, deps) {
  if (command.flags.check) return deps.setupCommand(command)
  const taken = await deps.lock.acquire({ mode: "setup", pid: deps.pid })
  if (!taken.ok) {
    return refuseMode(
      deps,
      `another release check holds the lock (mode ${taken.lock.mode}, pid ${taken.lock.pid})`,
    )
  }
  try {
    return await deps.setupCommand(command)
  } finally {
    taken.release()
  }
}

module.exports = {
  LifecycleError,
  TIME_LIMITS,
  childArgs,
  createDeps,
  executeRun,
  recoverCommand,
  runCommand,
  setupMode,
  spawnDetached,
  statusCommand,
  stopCommand,
}
