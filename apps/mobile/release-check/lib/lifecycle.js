"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, AbortSignal, clearTimeout, module, require, setTimeout */

const fs = require("node:fs")
const path = require("node:path")

const { EXIT } = require("./contract")
const { createDeps, spawnDetached } = require("./deps")
const { ADMIN_SCHEMA_PATH, sha256 } = require("./lists")
const lockLib = require("./lock")
const { recoverCommand, setupMode, stopCommand } = require("./modes")
const plan = require("./plan")
const { DEFAULT_KEEP } = require("./report/retention")
const {
  devicePins,
  mergeAttempts,
  proposeActions,
  toolVersions,
  unattributedRefusal,
} = require("./report/runInputs")
const {
  MARKDOWN_FILE,
  REPORT_FILE,
  SUMMARY_FILE,
  SummaryError,
} = require("./report/summary")
const runFolder = require("./runFolder")
const { artifactPath, pruneBuilds } = require("./testBuild/builds")

const MINUTE = 60_000

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

function lockHeldRefusal(lock) {
  return {
    code: "LOCK_HELD",
    message: `Another release check holds the lock (${lockLib.holderText(lock)}).`,
  }
}

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
    journeyRefusals: null,
    logRefusals: null,
    speed: null,
    speedWindow: null,
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

  function runLogCheck(expectedDevices) {
    const result = deps.logCheck(logPath, {
      operations: config.operations,
      expectedDevices,
    })
    // A request whose handler failed can be missing from the log.
    const failures = server.stats().handlerFailures ?? 0
    const findings = [...result.findings]
    if (failures > 0) {
      findings.push(
        finding(
          "SERVER_HANDLER_FAILED",
          `The read-only server could not complete ${failures} request${failures === 1 ? "" : "s"}, so the server log can be missing ${failures === 1 ? "it" : "them"}.`,
        ),
      )
    }
    state.checks.log = {
      passed: result.passed && failures === 0,
      findings,
      perDevice: result.perDevice,
      routes: result.routes,
    }
    state.logRefusals = result.rateLimitRefusals
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
      state.attempts = result.attempts ?? []
      state.checks.settingsProbe = {
        passed: result.passed === true,
        findings: result.findings ?? [],
      }
      if (result.passed !== true) requestStop("probe_failed")
    })
    await phase("journeys", async (signal) => {
      const result = await deps.phases.journeys(phaseContext(signal))
      state.attempts = mergeAttempts(state.attempts, result.attempts ?? [])
      if (result.settingsProbe) {
        const earlier = state.checks.settingsProbe ?? {
          passed: true,
          findings: [],
        }
        state.checks.settingsProbe = {
          passed: earlier.passed && result.settingsProbe.passed === true,
          findings: [
            ...earlier.findings,
            ...(result.settingsProbe.findings ?? []),
          ],
        }
      }
      state.restarts = result.restarts ?? []
      state.staleKnownBugs = result.staleKnownBugs ?? []
      if (result.screens !== undefined) state.checks.screens = result.screens
      if (result.rateLimitRefusals) {
        state.journeyRefusals = result.rateLimitRefusals
      }
      if (result.stopReason) requestStop(result.stopReason)
    })
    if (!flags["skip-speed-pass"]) {
      await phase("speed", async (signal) => {
        state.speedWindow = { startMs: deps.now(), endMs: Infinity }
        server.setSpeedMode(true)
        try {
          state.speed = await deps.phases.speed(phaseContext(signal))
        } finally {
          server.setSpeedMode(false)
          state.speedWindow.endMs = deps.now()
        }
      })
    }
    await phase("logcheck", async () => {
      await closeServer()
      runLogCheck(selection.devices.map((device) => device.id))
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

  async function endRun() {
    clearTimeout(runTimer)
    requestStop("completed")
    recorder.phase("ending")
    log(`ending (${state.stopReason})`)
    await endStep("stop_children", () => deps.stopChildren())
    await endStep("close_server", closeServer)
    // An early stop skips the logcheck phase, but the server can already have
    // forwarded requests. Only a device that started must show traffic.
    await endStep("log_check", () => {
      if (state.checks.log !== null || !fs.existsSync(logPath)) return
      const started = new Set(
        state.attempts
          .filter((item) => item?.status !== "not_run")
          .map((item) => item?.deviceId),
      )
      runLogCheck(
        selection.devices
          .map((device) => device.id)
          .filter((id) => started.has(id)),
      )
    })
    const stats = (await endStep("server_stats", () => server.stats())) ?? {}
    await endStep("stop_devices", async () => {
      const results = await deps.devices.stopOwned(await deps.devices.list())
      for (const item of results ?? []) {
        if (!item.ok) recorder.event({ type: "device_not_stopped", ...item })
      }
    })
    // The journeys phase reads the server log before the speed pass starts,
    // so the speed pass's refusals come from the whole log, by time (R36).
    const logged = state.logRefusals ?? stats.rateLimitRefusals ?? []
    const speedWindow = state.speedWindow
    const inSpeedPass = (item) => {
      const ms = Date.parse(item.ts)
      return (
        speedWindow !== null &&
        ms >= speedWindow.startMs &&
        ms <= speedWindow.endMs
      )
    }
    const refusals = state.journeyRefusals
      ? [
          ...state.journeyRefusals,
          ...logged.filter(inSpeedPass).map(unattributedRefusal),
        ]
      : logged.map(unattributedRefusal)
    const proposedActions =
      (await endStep("proposed_actions", () =>
        proposeActions({
          attempts: state.attempts,
          staleKnownBugs: state.staleKnownBugs,
          screens: state.checks.screens,
          logLines: require("./journeys/classify").readServerLog(logPath),
        }),
      )) ?? []
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
          proposedActions,
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
  const holder = lock.lock ? ` (${lockLib.holderText(lock.lock)})` : ""
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

async function statusCommand(command, deps) {
  const lock = await deps.lock.inspect()
  const runDir = runFolder.newestRunDir(deps.home)
  const run = runDir ? describeRun(deps, runDir, lock) : null
  deps.out(
    command.flags.json
      ? JSON.stringify(
          { mode: "status", lock: lockLib.summarizeLock(lock), run },
          null,
          2,
        )
      : statusText(lock, run),
  )
  return EXIT.passed
}

module.exports = {
  childArgs,
  createDeps,
  recoverCommand,
  runCommand,
  setupMode,
  spawnDetached,
  statusCommand,
  stopCommand,
}
