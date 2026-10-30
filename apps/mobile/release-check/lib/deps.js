"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const childProcess = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const readline = require("node:readline")

const {
  CONFIG_DIR,
  JOURNEYS_DIR,
  LIST_FILES,
  REPO_ROOT,
  readJson,
  sha256,
} = require("./lists")
const lockLib = require("./lock")
const plan = require("./plan")
const proc = require("./proc")
const { applyRetention } = require("./report/retention")
const { buildSummary, renderReport, writeSummary } = require("./report/summary")

const CLI_PATH = path.resolve(__dirname, "..", "cli.mjs")
const MINUTE = 60_000
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
const GIT_TIMEOUT_MS = 2 * MINUTE
const GIT_OUTPUT_BYTES = 32 * 1024 * 1024

class LifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LifecycleError"
    this.code = code
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
    devices: read(LIST_FILES.devices),
    settings: read(LIST_FILES.testSettings),
    operations: read(LIST_FILES.operations),
    searchAnswers: read(LIST_FILES.searchAnswers),
    notTested: read(LIST_FILES.notTested),
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
      speed: require("./speed").createSpeedPhase(),
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

module.exports = {
  TIME_LIMITS,
  createDeps,
  spawnDetached,
}
