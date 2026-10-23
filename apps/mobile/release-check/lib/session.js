"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, module, require */

const fs = require("node:fs")
const path = require("node:path")

const { EXIT, refuseMode } = require("./contract")
const { createEmulator } = require("./devices/android")
const inventoryLib = require("./devices/inventory")
const { createSimulator } = require("./devices/ios")
const classify = require("./journeys/classify")
const { runMaestro } = require("./journeys/maestro")
const { APP_ID, ATTEMPT_LIMIT_MS } = require("./journeys/phases")
const { pruneDeviceLogs, readAttemptOutput } = require("./journeys/results")
const { shownPlatforms } = require("./journeys/screens")
const {
  ADMIN_SCHEMA_PATH,
  JOURNEYS_DIR,
  LIST_FILES,
  readJson,
} = require("./lists")
const lockLib = require("./lock")
const runFolder = require("./runFolder")

const SESSION_FILE = "session.json"
const STATE_FILE = "state.json"
const SESSION_LOG = "session.log"
const PROCESS_LOG = "process.log"
const SESSIONS_DIR = "sessions"
const SIMCTL_TIMEOUT_MS = 60_000
const MINUTE = 60_000
// A new build can take 45 minutes and a boot 5 more (lifecycle TIME_LIMITS).
const UP_WAIT_MS = 120 * MINUTE
const DOWN_WAIT_MS = 2 * MINUTE
const LIVE_STATES = new Set(["starting", "ready", "stopping"])
const STOP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"]
const JOURNEY_ID = /^[a-z0-9][a-z0-9-]*$/

class SessionError extends Error {
  constructor(code, message, { refused = false } = {}) {
    super(message)
    this.name = "SessionError"
    this.code = code
    this.refused = refused
  }
}

function untilAborted(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener("abort", resolve, { once: true })
  })
}

function createSessionDeps(overrides = {}) {
  const lifecycle = require("./lifecycle")
  return {
    createSimulator,
    createEmulator,
    listInventory: inventoryLib.listInventory,
    runChild: require("./proc").run,
    stopChildren: () => require("./proc").stopAll(),
    runMaestro,
    processStart: (pid) => lockLib.processStart(pid),
    releaseLock: lockLib.releaseLock,
    sleep: inventoryLib.defaultSleep,
    journeysDir: JOURNEYS_DIR,
    sessionEntry: __filename,
    upWaitMs: UP_WAIT_MS,
    downWaitMs: DOWN_WAIT_MS,
    ...lifecycle.createDeps(overrides),
  }
}

// A devices.json id, or a `Forge RC` simulator or `forge_rc_` AVD name from
// that list. Anything else is refused, so a session never uses another's (R7).
function resolveRunnerDevice(input, devicesConfig) {
  const devices = devicesConfig.devices
  const ids = devices.map((device) => device.id).join(", ")
  const byId = devices.find((device) => device.id === input)
  if (byId) return { device: byId }
  const simPrefix = inventoryLib.simulatorPrefix(devicesConfig)
  const avdPrefix = inventoryLib.avdPrefix(devicesConfig)
  if (!input.startsWith(simPrefix) && !input.startsWith(avdPrefix)) {
    return {
      refusal: {
        code: "NOT_RUNNER_DEVICE",
        message: `\`${input}\` is not a runner device. A session uses only the runner's own devices, whose names start with \`${simPrefix.trim()}\` (AVDs with \`${avdPrefix}\`). Use a device id: ${ids}`,
      },
    }
  }
  const named = devices.find(
    (device) => device.name === input || device.avd === input,
  )
  if (named) return { device: named }
  return {
    refusal: {
      code: "UNKNOWN_DEVICE",
      message: `\`${input}\` is not in config/devices.json. Use a device id: ${ids}`,
    },
  }
}

function lanePort(settings, lane) {
  return settings.ports[inventoryLib.LANE_PORT_NAMES[lane]]
}

async function buildFindings(deps, file) {
  try {
    const result = await deps.build.checkArtifact(file, {
      settings: deps.config.settings,
      env: deps.env,
    })
    return result.findings
  } catch (error) {
    if (error.name !== "ArtifactCheckRefusal") throw error
    return [{ code: "BUILD_CHECK_REFUSED", message: error.message }]
  }
}

// The checked build of HEAD for each platform: `<home>/builds/<commit>` when it
// passes the build check, else a new build, which needs clean inputs (R8).
// Every caller holds the lock, so no run or other session uses a pruned build.
async function checkedBuild(deps, { platforms, signal }) {
  const { artifactPath, pruneBuilds } = require("./lifecycle")
  const commit = await deps.git.head()
  const buildDir = path.join(deps.home, "builds", commit)
  const artifacts = {}
  const missing = []
  for (const platform of platforms) {
    const file = artifactPath(buildDir, platform)
    if (file && (await buildFindings(deps, file)).length === 0) {
      artifacts[platform] = file
    } else {
      missing.push(platform)
    }
  }
  if (missing.length === 0) {
    pruneBuilds(deps.home, commit, deps.now())
    return { commit, buildDir, artifacts, built: [] }
  }
  const dirty = await deps.git.dirty()
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 10).join(", ")
    throw new SessionError(
      "DIRTY_BUILD_INPUTS",
      `no checked ${missing.join(" and ")} build of ${commit.slice(0, 9)} exists, and a new build needs clean build inputs. Commit or stash these files: ${shown}${dirty.length > 10 ? `, and ${dirty.length - 10} more` : ""}`,
      { refused: true },
    )
  }
  const result = await deps.build.buildTestApps({
    repoRoot: deps.repoRoot,
    commit,
    buildDir,
    settings: deps.config.settings,
    platforms: missing,
    home: deps.home,
    parentEnv: deps.env,
    signal,
  })
  if (!result.ok) {
    throw new SessionError(
      "BUILD_FAILED",
      `the test build failed at ${result.failedStep}; the logs are in ${path.join(buildDir, "logs")}`,
    )
  }
  for (const platform of missing) {
    const file = result.platforms[platform].artifact
    const findings = await buildFindings(deps, file)
    if (findings.length > 0) {
      throw new SessionError(
        "BUILD_CHECK_FAILED",
        `the build check of ${file} found ${findings.map((item) => item.code).join(", ")}`,
      )
    }
    artifacts[platform] = file
  }
  pruneBuilds(deps.home, commit, deps.now())
  return { commit, buildDir, artifacts, built: missing }
}

/** A device handle; `udid` comes from the inventory when it is not given. */
async function openDevice(deps, device, { udid = null, logFile } = {}) {
  const env = inventoryLib.toolEnv(deps.env)
  const pins = deps.config.devices.pins
  if (device.platform === "ios") {
    let found = udid
    if (!found) {
      const inventory = await deps.listInventory({
        config: deps.config.devices,
        env,
      })
      found = inventory.owned.find((owned) => owned.id === device.id)?.udid
    }
    if (!found) {
      throw new SessionError(
        "DEVICE_MISSING",
        `${device.name} does not exist; run \`setup\``,
      )
    }
    return deps.createSimulator({ ...device, udid: found }, { env, pins })
  }
  const ports = deps.config.settings.ports
  return deps.createEmulator(
    {
      ...device,
      hostPort: lanePort(deps.config.settings, device.lane),
      devicePort: ports.device,
    },
    { env, pins, logFile },
  )
}

async function resetApp(deps, device, handle, artifacts, signal) {
  if (device.platform === "android") return handle.prepareApp(APP_ID)
  await handle.terminate(APP_ID)
  const result = await deps.runChild(
    inventoryLib.XCRUN,
    ["simctl", "uninstall", handle.udid, APP_ID],
    {
      env: inventoryLib.toolEnv(deps.env),
      timeoutMs: SIMCTL_TIMEOUT_MS,
      signal,
    },
  )
  const removed = inventoryLib.toolOutcome(
    result,
    "simctl uninstall",
    SIMCTL_TIMEOUT_MS,
  )
  if (!removed.ok) return removed
  return handle.install(artifacts.ios)
}

function journeyVariables(deps, platform) {
  const screensConfig = readJson(path.join(deps.configDir, LIST_FILES.screens))
  const explore = shownPlatforms(
    screensConfig,
    deps.config.settings,
    "tab-explore",
  ).includes(platform)
  return { EXPLORE_TAB: explore ? "shown" : "hidden" }
}

async function appEvidence(deps, device, handle, window, answered) {
  if (device.platform === "ios") {
    const reports = classify.iosCrashReports({
      udid: handle.udid,
      bundleId: APP_ID,
      ...window,
    })
    return reports.length > 0 ? ["app_crashed"] : []
  }
  if (!answered) return []
  return classify.androidEvidence({
    serial: handle.serial,
    appId: APP_ID,
    env: inventoryLib.toolEnv(deps.env),
    ...window,
  })
}

async function runJourneyOnce(
  deps,
  { device, handle, flowFile, outputDir, artifacts, serverLog, signal },
) {
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const base = { deviceId: device.id, outputDir, steps: [], screenshot: null }
  const reset = await resetApp(deps, device, handle, artifacts, signal)
  if (!reset.ok) {
    return {
      ...base,
      passed: false,
      class: "device_unresponsive",
      failedStep: null,
      error: `The app reset failed: ${reset.error}`,
    }
  }
  const startMs = deps.now()
  const result = await deps.runMaestro({
    platform: device.platform,
    deviceRef: device.platform === "ios" ? handle.udid : handle.serial,
    flowFile,
    outputDir,
    variables: journeyVariables(deps, device.platform),
    sourceEnv: deps.env,
    timeoutMs: ATTEMPT_LIMIT_MS,
    signal,
  })
  const endMs = deps.now()
  const output = readAttemptOutput(outputDir)
  pruneDeviceLogs(outputDir)
  const steps = output.commands.map((command) => ({
    label: command.label,
    command: command.type,
    status: command.status,
    ms: command.ms,
    error: command.error,
  }))
  if (result.code === 0 && !output.failed && !result.timedOut) {
    return { ...base, steps, passed: true, class: null, failedStep: null }
  }
  if (result.stopped) {
    return {
      ...base,
      steps,
      passed: false,
      class: null,
      failedStep: null,
      error: "The attempt was stopped.",
    }
  }
  const probe = await handle.probe()
  const window = { startMs, endMs }
  const verdict = classify.classifyFailure({
    deviceProblem: probe.ok
      ? null
      : (probe.error ?? "The device did not answer."),
    appEvidence: await appEvidence(deps, device, handle, window, probe.ok),
    server: classify.serverSignals(classify.readServerLog(serverLog), {
      deviceId: device.id,
      ...window,
    }),
    maestro: result,
    output,
    timeoutMs: ATTEMPT_LIMIT_MS,
  })
  return {
    ...base,
    steps,
    passed: false,
    class: verdict.class,
    failedStep: output.failed?.label ?? null,
    error: verdict.error,
    screenshot: output.screenshot,
  }
}

function sessionFile(home) {
  return path.join(home, SESSION_FILE)
}

function readSession(home) {
  return runFolder.readJsonOrNull(sessionFile(home))
}

async function sessionAlive(deps, record) {
  if (!Number.isInteger(record?.pid) || !deps.isAlive(record.pid)) return false
  return (await deps.processStart(record.pid)) === record.processStart
}

function appendSessionLog(sessionDir, now, text) {
  fs.appendFileSync(
    path.join(sessionDir, SESSION_LOG),
    `${new Date(now()).toISOString()} ${text}\n`,
  )
}

// The detached session process: it must outlive `session up`, so it holds the
// lock, the build, the server, and the device until SIGTERM (`session down`).
async function serveSession({ sessionDir, deviceId }, deps) {
  const sessionId = path.basename(sessionDir)
  const device = deps.config.devices.devices.find(
    (entry) => entry.id === deviceId,
  )
  const log = (text) => appendSessionLog(sessionDir, deps.now, text)
  let record = {
    schemaVersion: 1,
    sessionId,
    sessionDir,
    pid: deps.pid,
    processStart: null,
    state: "starting",
    deviceId,
    platform: device?.platform ?? null,
    lane: device?.lane ?? null,
    appId: APP_ID,
    startedAt: new Date(deps.now()).toISOString(),
    error: null,
  }
  let holder = false
  const write = (fields) => {
    record = { ...record, ...fields }
    runFolder.writeJson(path.join(sessionDir, STATE_FILE), record)
    if (holder) runFolder.writeJson(sessionFile(deps.home), record)
  }
  if (!device) {
    write({ state: "failed", code: "UNKNOWN_DEVICE", refused: true })
    return EXIT.refused
  }
  const taken = await deps.lock.acquire({
    mode: "session",
    runId: sessionId,
    pid: deps.pid,
  })
  if (!taken.ok) {
    write({
      state: "failed",
      code: "LOCK_HELD",
      refused: true,
      error: `another release check holds the lock (${lockLib.holderText(taken.lock, { withRun: false })})`,
    })
    return EXIT.refused
  }
  holder = true
  write({ processStart: taken.lock.processStart })

  const abort = new AbortController()
  const onSignal = () => abort.abort()
  for (const name of STOP_SIGNALS) deps.signals.on(name, onSignal)
  let server = null
  let handle = null
  let booted = null
  let failure = null
  try {
    const build = await checkedBuild(deps, {
      platforms: [device.platform],
      signal: abort.signal,
    })
    if (build.built.length > 0) log(`built ${build.built.join(", ")}`)
    const port = lanePort(deps.config.settings, device.lane)
    const logPath = path.join(sessionDir, runFolder.SERVER_LOG)
    runFolder.writeRunFile(sessionDir, { sessionId, devices: [device.id] })
    server = deps.server.create({
      lanes: [{ port, lane: device.lane }],
      operations: deps.config.operations,
      searchAnswers: deps.config.searchAnswers,
      adminSchemaSdl: await deps.git.show(build.commit, ADMIN_SCHEMA_PATH),
      logPath,
      onUpstreamUnavailable: () =>
        log("5 forwarded reads in a row failed; production admin may be down"),
    })
    await server.bind()
    server.setLaneDevice(device.lane, device.id)
    server.startAnswering()
    if (abort.signal.aborted) throw new SessionError("ABORTED", "stopped")
    handle = await openDevice(deps, device, {
      logFile: path.join(sessionDir, `${device.id}-emulator.log`),
    })
    booted = await handle.boot()
    if (!booted.ok) throw new SessionError("DEVICE_BOOT_FAILED", booted.error)
    const installed = await handle.install(build.artifacts[device.platform])
    if (!installed.ok) {
      throw new SessionError("APP_INSTALL_FAILED", installed.error)
    }
    write({
      state: "ready",
      readyAt: new Date(deps.now()).toISOString(),
      commit: build.commit,
      artifact: build.artifacts[device.platform],
      port,
      logPath,
      udid: handle.udid ?? null,
      serial: handle.serial ?? null,
    })
    log(`session ready on ${device.id} (port ${port}, commit ${build.commit})`)
    await untilAborted(abort.signal)
  } catch (error) {
    failure = error
  } finally {
    if (!failure) write({ state: "stopping" })
    if (server) await server.close().catch(() => {})
    if (handle && booted?.refused !== true) {
      const stopped = await handle.shutdown()
      if (!stopped.ok) log(`the device did not stop: ${stopped.error}`)
    }
    for (const name of STOP_SIGNALS) deps.signals.off(name, onSignal)
  }
  const aborted = abort.signal.aborted
  if (failure && !aborted) {
    log(`session failed: ${failure.message}`)
    write({
      state: "failed",
      code: failure.code ?? "SESSION_FAILED",
      refused: failure.refused === true,
      error: failure.message,
      endedAt: new Date(deps.now()).toISOString(),
    })
  } else {
    log("session ended")
    write({ state: "ended", endedAt: new Date(deps.now()).toISOString() })
  }
  taken.release()
  if (!failure || aborted) return EXIT.passed
  return failure.refused ? EXIT.refused : EXIT.failed
}

async function upSession(command, deps) {
  const resolved = resolveRunnerDevice(
    command.flags.device,
    deps.config.devices,
  )
  if (resolved.refusal) return refuseMode(deps, resolved.refusal.message)
  const current = readSession(deps.home)
  if (current && LIVE_STATES.has(current.state)) {
    return refuseMode(
      deps,
      `session ${current.sessionId} on ${current.deviceId} is ${current.state}; run \`session down\` first`,
    )
  }
  const lock = await deps.lock.inspect()
  if (lock.state === "held") {
    return refuseMode(
      deps,
      `another release check holds the lock (${lockLib.holderText(lock.lock, { withRun: false })})`,
    )
  }
  const sessionId = runFolder.newRunId(new Date(deps.now()), deps.randomHex())
  const sessionDir = path.join(deps.home, SESSIONS_DIR, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  const child = deps.spawnDetached(
    deps.nodePath,
    [deps.sessionEntry, "serve", sessionDir, resolved.device.id],
    {
      cwd: deps.repoRoot,
      env: deps.env,
      logFile: path.join(sessionDir, PROCESS_LOG),
    },
  )
  const stateFile = path.join(sessionDir, STATE_FILE)
  const end = deps.now() + deps.upWaitMs
  for (;;) {
    const state = runFolder.readJsonOrNull(stateFile)
    if (state?.state === "ready") {
      deps.out(
        JSON.stringify({
          deviceId: state.deviceId,
          appId: state.appId,
          port: state.port,
          logPath: state.logPath,
          sessionDir,
        }),
      )
      return EXIT.passed
    }
    if (state && !LIVE_STATES.has(state.state)) {
      deps.err(
        `release-check session up ${state.refused ? "refused" : "failed"}: ${state.code}: ${state.error}. See ${path.join(sessionDir, PROCESS_LOG)}.`,
      )
      return state.refused ? EXIT.refused : EXIT.failed
    }
    if (!deps.isAlive(child.pid)) {
      deps.err(
        `release-check session up failed: the session process ended before it was ready. See ${path.join(sessionDir, PROCESS_LOG)}.`,
      )
      return EXIT.failed
    }
    if (deps.now() > end) {
      deps.kill(child.pid, "SIGTERM")
      deps.err(
        `release-check session up failed: the session was not ready within ${Math.round(deps.upWaitMs / MINUTE)} minutes, so it was stopped.`,
      )
      return EXIT.failed
    }
    await deps.sleep(deps.pollMs)
  }
}

/** A top-level journey id, or a .yaml path inside the journeys folder. */
function resolveJourney(input, journeysDir) {
  const root = path.resolve(journeysDir)
  const file = JOURNEY_ID.test(input)
    ? path.join(root, `${input}.yaml`)
    : path.resolve(input)
  const relative = path.relative(root, file)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      refusal: `\`${input}\` is not a journey id or a file inside ${root}`,
    }
  }
  if (!/\.ya?ml$/.test(file) || !fs.existsSync(file)) {
    return { refusal: `the journey ${file} does not exist` }
  }
  return { id: path.basename(file).replace(/\.ya?ml$/, ""), file }
}

function nextTryDir(sessionDir, journeyId) {
  const triesDir = path.join(sessionDir, "tries")
  const count = fs.existsSync(triesDir) ? fs.readdirSync(triesDir).length : 0
  return path.join(
    triesDir,
    `${String(count + 1).padStart(3, "0")}-${journeyId}`,
  )
}

async function liveSession(deps) {
  const record = readSession(deps.home)
  if (!record) {
    return {
      refusal: "no session is up; start one with `session up --device <id>`",
    }
  }
  if (record.state !== "ready") {
    return {
      refusal: `session ${record.sessionId} is ${record.state}, not ready`,
    }
  }
  if (!(await sessionAlive(deps, record))) {
    return {
      refusal: `the session process (pid ${record.pid}) ended; run \`session down\` to clean up`,
    }
  }
  return { record }
}

async function trySession(command, deps) {
  const live = await liveSession(deps)
  if (live.refusal) return refuseMode(deps, live.refusal)
  const { record } = live
  const journey = resolveJourney(command.positionals[0], deps.journeysDir)
  if (journey.refusal) return refuseMode(deps, journey.refusal)
  const device = deps.config.devices.devices.find(
    (entry) => entry.id === record.deviceId,
  )
  const handle = await openDevice(deps, device, { udid: record.udid })
  const abort = new AbortController()
  const onSignal = () => abort.abort()
  deps.signals.on("SIGINT", onSignal)
  deps.signals.on("SIGTERM", onSignal)
  let attempt
  try {
    attempt = await runJourneyOnce(deps, {
      device,
      handle,
      flowFile: journey.file,
      outputDir: nextTryDir(record.sessionDir, journey.id),
      artifacts: { [device.platform]: record.artifact },
      serverLog: record.logPath,
      signal: abort.signal,
    })
  } finally {
    deps.signals.off("SIGINT", onSignal)
    deps.signals.off("SIGTERM", onSignal)
  }
  appendSessionLog(
    record.sessionDir,
    deps.now,
    `try ${journey.id} ${attempt.passed ? "passed" : `failed (${attempt.class ?? "no class"}) at ${attempt.failedStep ?? "the start"}`}; output ${attempt.outputDir}`,
  )
  deps.out(
    JSON.stringify(
      {
        journey: journey.id,
        file: journey.file,
        deviceId: record.deviceId,
        passed: attempt.passed,
        class: attempt.class,
        failedStep: attempt.failedStep,
        error: attempt.error ?? null,
        screenshot: attempt.screenshot,
        outputDir: attempt.outputDir,
        steps: attempt.steps,
      },
      null,
      2,
    ),
  )
  return attempt.passed ? EXIT.passed : EXIT.failed
}

async function waitUntil(deps, check, limitMs) {
  const end = deps.now() + limitMs
  while (deps.now() < end) {
    if (check()) return true
    await deps.sleep(deps.pollMs)
  }
  return check()
}

async function cleanUpDeadSession(deps, record) {
  const notes = []
  if (record.state === "ended" || record.state === "failed") return notes
  const device = deps.config.devices.devices.find(
    (entry) => entry.id === record.deviceId,
  )
  if (device && (record.udid || device.platform === "android")) {
    const handle = await openDevice(deps, device, { udid: record.udid })
    const stopped = await handle.shutdown()
    notes.push(
      !stopped.ok
        ? `${device.id} did not stop: ${stopped.error}`
        : stopped.skipped
          ? stopped.note
          : `stopped ${device.id}`,
    )
  }
  if (record.processStart) {
    deps.releaseLock(deps.home, {
      pid: record.pid,
      processStart: record.processStart,
      mode: "session",
      runId: record.sessionId,
    })
  }
  return notes
}

async function downSession(command, deps) {
  const record = readSession(deps.home)
  if (!record) return refuseMode(deps, "no session is up")
  const stateFile = path.join(record.sessionDir, STATE_FILE)
  const notes = []
  let stopped = true
  if (await sessionAlive(deps, record)) {
    deps.kill(record.pid, "SIGTERM")
    stopped = await waitUntil(
      deps,
      () => !deps.isAlive(record.pid),
      deps.downWaitMs,
    )
    if (!stopped) {
      notes.push(
        `the session process (pid ${record.pid}) did not stop within ${Math.round(deps.downWaitMs / 1000)} s`,
      )
    }
  } else {
    notes.push(...(await cleanUpDeadSession(deps, record)))
  }
  const final = runFolder.readJsonOrNull(stateFile) ?? record
  const logPath = path.join(record.sessionDir, runFolder.SERVER_LOG)
  let logCheck = null
  if (fs.existsSync(logPath)) {
    const result = deps.logCheck(logPath, {
      operations: deps.config.operations,
      expectedDevices: [record.deviceId],
    })
    logCheck = {
      passed: result.passed,
      findings: result.findings,
      perDevice: result.perDevice,
      routes: result.routes,
    }
  } else {
    notes.push("the session wrote no server log, so there is nothing to check")
  }
  if (stopped) fs.rmSync(sessionFile(deps.home), { force: true })
  deps.out(
    JSON.stringify(
      {
        sessionId: record.sessionId,
        deviceId: record.deviceId,
        state: stopped ? "ended" : final.state,
        logCheck,
        notes,
      },
      null,
      2,
    ),
  )
  return stopped && (logCheck === null || logCheck.passed)
    ? EXIT.passed
    : EXIT.failed
}

async function sessionCommand(command, deps = createSessionDeps()) {
  if (command.subcommand === "up") return upSession(command, deps)
  if (command.subcommand === "try") return trySession(command, deps)
  return downSession(command, deps)
}

module.exports = {
  SESSION_FILE,
  checkedBuild,
  createSessionDeps,
  lanePort,
  openDevice,
  resolveRunnerDevice,
  runJourneyOnce,
  serveSession,
  sessionCommand,
}

if (require.main === module) {
  const [step, sessionDir, deviceId] = process.argv.slice(2)
  if (step === "serve") {
    serveSession({ sessionDir, deviceId }, createSessionDeps()).then(
      (code) => {
        process.exitCode = code
      },
      (error) => {
        console.error(`release-check session failed: ${error.stack}`)
        process.exitCode = EXIT.failed
      },
    )
  }
}
