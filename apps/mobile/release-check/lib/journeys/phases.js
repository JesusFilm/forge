"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global clearTimeout, module, require, setTimeout */
// The `probing` and `journeys` phases of a run (U6 contract, KTD5, KTD6,
// KTD11, KTD14). Each lane runs its devices in order through the host gate;
// the settings probe runs first on each device and a failure stops the run.

const fs = require("node:fs")
const path = require("node:path")

const inventoryLib = require("../devices/inventory")
const { createEmulator } = require("../devices/android")
const { createSimulator } = require("../devices/ios")
const {
  CONFIG_DIR,
  JOURNEYS_DIR,
  LIST_FILES,
  MOBILE_DIR,
  readJson,
  screenInventory,
} = require("../lists")
const { run: runProc } = require("../proc")
const { SERVER_LOG } = require("../runFolder")
const classify = require("./classify")
const { staleKnownBugs } = require("./knownBugs")
const { runMaestro } = require("./maestro")
const {
  notRunLabels,
  pruneDeviceLogs,
  readAttemptOutput,
  screensReachedFrom,
} = require("./results")
const { attemptRecord, notRunRecord, runJourney, runQueue } = require("./retry")
const {
  notReachedScreens,
  planJourneys,
  readJourneys,
  screenCoverage,
  shownPlatforms,
} = require("./screens")

const PROBE_ID = "settings-probe"
const APP_ID = "org.jesusfilm.forgewatch"
const ATTEMPT_LIMIT_MS = 10 * 60_000
const SIMCTL_TIMEOUT_MS = 60_000
const ADB_TIMEOUT_MS = 20_000
const PROBE_FILE = "apps/mobile/release-check/journeys/settings-probe.yaml"

function copyJourneys(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    if (entry.isDirectory()) copyJourneys(source, path.join(to, entry.name))
    else if (/\.ya?ml$/.test(entry.name)) {
      fs.copyFileSync(source, path.join(to, entry.name))
    }
  }
}

function lanesOf(devices) {
  const lanes = new Map()
  for (const device of devices) {
    const lane = lanes.get(device.lane) ?? { name: device.lane, devices: [] }
    lane.devices.push(device)
    lanes.set(device.lane, lane)
  }
  return [...lanes.values()]
}

function relativeTo(runDir, file) {
  return file ? path.relative(runDir, file).split(path.sep).join("/") : null
}

// The phases for `createDeps().phases`. A test injects the device, Maestro,
// and evidence layers through `options`.
function createJourneyPhases(options = {}) {
  const journeysDir = options.journeysDir ?? JOURNEYS_DIR
  const configDir = options.configDir ?? CONFIG_DIR
  const mobileDir = options.mobileDir ?? MOBILE_DIR
  const runChild = options.runChild ?? runProc
  const maestro = options.runMaestro ?? runMaestro
  const now = options.now ?? Date.now
  const runs = new Map()

  // The run reads its own copy of the journeys, so each attempt follows the
  // same steps even when the checkout changes during the run (R20, KTD2).
  function startRun(ctx) {
    const snapshot = path.join(ctx.runDir, "journeys")
    copyJourneys(journeysDir, snapshot)
    const journeys = readJourneys(snapshot)
    const flows = new Map(journeys.map((journey) => [journey.id, journey]))
    if (!flows.has(PROBE_ID)) {
      throw new Error(`the ${PROBE_ID} journey is missing from ${journeysDir}`)
    }
    const read = (name) => readJson(path.join(configDir, LIST_FILES[name]))
    const screensConfig = read("screens")
    const inventory = screenInventory(screensConfig, mobileDir)
    const run = {
      flows,
      screensConfig,
      inventory,
      knownBugs: read("knownBugs").entries ?? [],
      notTested: read("notTested"),
      plan: planJourneys(journeys, screensConfig, ctx.settings),
      lanes: lanesOf(ctx.selection.devices).map((lane) => ({
        ...lane,
        probed: [],
      })),
      attempts: [],
      restarts: [],
      windows: [],
      udids: null,
      probeFailures: [],
    }
    runs.set(ctx.runId, run)
    return run
  }

  function variablesFor(run, ctx, platform) {
    const explore = shownPlatforms(
      run.screensConfig,
      ctx.settings,
      "tab-explore",
    ).includes(platform)
    return { EXPLORE_TAB: explore ? "shown" : "hidden" }
  }

  function queueFor(run, ctx, device) {
    return ctx.selection.journeys.filter(
      (id) =>
        id !== PROBE_ID &&
        run.plan
          .find((entry) => entry.id === id)
          ?.platforms.includes(device.platform),
    )
  }

  function toolEnv(ctx) {
    return inventoryLib.toolEnv(ctx.env)
  }

  async function iosUdid(run, ctx, device) {
    if (!run.udids) {
      const list = await (options.listInventory ?? inventoryLib.listInventory)({
        config: ctx.devicesConfig,
        env: toolEnv(ctx),
      })
      run.udids = new Map(list.owned.map((owned) => [owned.id, owned.udid]))
    }
    return run.udids.get(device.id) ?? null
  }

  async function openHandle(run, ctx, device) {
    const env = toolEnv(ctx)
    const pins = ctx.devicesConfig.pins
    if (device.platform === "ios") {
      const udid = await iosUdid(run, ctx, device)
      if (!udid) return null
      return (options.createSimulator ?? createSimulator)(
        { ...device, udid },
        { env, pins },
      )
    }
    const ports = ctx.settings.ports
    const hostPorts = {
      androidPhone: ports.hostAndroidPhone,
      androidTablet: ports.hostAndroidTablet,
    }
    fs.mkdirSync(path.join(ctx.runDir, "devices"), { recursive: true })
    return (options.createEmulator ?? createEmulator)(
      {
        ...device,
        hostPort: hostPorts[device.lane],
        devicePort: ports.device,
      },
      {
        env,
        pins,
        logFile: path.join(ctx.runDir, "devices", `${device.id}-emulator.log`),
      },
    )
  }

  // ── One device ─────────────────────────────────────────────────────

  async function startDevice(run, ctx, device) {
    const admitted = await ctx.admit(device)
    if (!admitted.admitted) return { device, started: false, admitted: false }
    ctx.server.setLaneDevice(device.lane, device.id)
    const handle = await openHandle(run, ctx, device)
    const fail = async (error) => {
      if (handle) await handle.shutdown()
      ctx.release(device)
      ctx.event({ type: "device_start_failed", deviceId: device.id, error })
      return { device, started: false, admitted: true, error }
    }
    if (!handle) return fail(`${device.name} has no simulator; run setup`)
    const boot = await handle.boot()
    if (!boot.ok) return fail(boot.error)
    if (device.platform === "android") {
      const installed = await handle.install(ctx.artifacts.android)
      if (!installed.ok) return fail(installed.error)
    }
    ctx.event({ type: "device_started", deviceId: device.id })
    return { device, handle, started: true }
  }

  async function stopDevice(ctx, entry) {
    if (!entry.started || ctx.signal.aborted) return
    const stopped = await entry.handle.shutdown()
    if (!stopped.ok) {
      ctx.event({
        type: "device_not_stopped",
        deviceId: entry.device.id,
        error: stopped.error,
      })
    }
    ctx.release(entry.device)
  }

  // iOS: a fresh install for each attempt. Android: U5's prepareApp clears the
  // app and fixes the notification denial (README section 2).
  async function resetApp(ctx, entry) {
    const { device, handle } = entry
    if (device.platform === "android") return handle.prepareApp(APP_ID)
    const started = now()
    await handle.terminate(APP_ID)
    const result = await runChild(
      inventoryLib.XCRUN,
      ["simctl", "uninstall", handle.udid, APP_ID],
      { env: toolEnv(ctx), timeoutMs: SIMCTL_TIMEOUT_MS, signal: ctx.signal },
    )
    const removed = inventoryLib.toolOutcome(
      result,
      "simctl uninstall",
      SIMCTL_TIMEOUT_MS,
    )
    if (!removed.ok) return removed
    const installed = await handle.install(ctx.artifacts.ios)
    ctx.event({
      type: "ios_app_reset",
      deviceId: device.id,
      ms: now() - started,
    })
    return installed
  }

  // KTD14: after each failed attempt, force-stop the app and clear dialogs.
  async function cleanUp(ctx, entry) {
    await entry.handle.terminate(APP_ID)
    if (entry.device.platform !== "android") return
    await runChild(
      inventoryLib.toolPaths(toolEnv(ctx)).adb,
      [
        "-s",
        entry.handle.serial,
        "shell",
        "am",
        "broadcast",
        "-a",
        "android.intent.action.CLOSE_SYSTEM_DIALOGS",
      ],
      { env: toolEnv(ctx), timeoutMs: ADB_TIMEOUT_MS },
    )
  }

  async function appEvidence(ctx, entry, window, deviceAnswered) {
    if (options.appEvidence) {
      return options.appEvidence(entry, window, deviceAnswered)
    }
    if (entry.device.platform === "ios") {
      const reports = classify.iosCrashReports({
        udid: entry.handle.udid,
        bundleId: APP_ID,
        ...window,
      })
      return reports.length > 0 ? ["app_crashed"] : []
    }
    if (!deviceAnswered) return []
    return classify.androidEvidence({
      serial: entry.handle.serial,
      appId: APP_ID,
      env: toolEnv(ctx),
      ...window,
    })
  }

  async function runAttempt(run, ctx, entry, journeyId, n) {
    const { device, handle } = entry
    const journey = run.flows.get(journeyId)
    const outputDir = path.join(
      ctx.runDir,
      "attempts",
      journeyId,
      device.id,
      String(n),
    )
    fs.rmSync(outputDir, { recursive: true, force: true })
    fs.mkdirSync(outputDir, { recursive: true })
    const base = { journey: journeyId, deviceId: device.id, attempt: n }
    const allSteps = journey.flow.topLevel.map((step) => step.label)
    const reset = await resetApp(ctx, entry)
    if (ctx.signal.aborted) return { stopped: true }
    if (!reset.ok) {
      const probe = await handle.probe()
      return {
        passed: false,
        deviceAnswered: probe.ok,
        retryAfterMs: null,
        record: attemptRecord({
          ...base,
          class: "device_unresponsive",
          error: `The app reset failed: ${reset.error}`,
          notRunSteps: allSteps.filter(Boolean),
        }),
      }
    }
    const startMs = now()
    const result = await maestro({
      platform: device.platform,
      deviceRef: device.platform === "ios" ? handle.udid : handle.serial,
      flowFile: journey.file,
      outputDir,
      variables: variablesFor(run, ctx, device.platform),
      sourceEnv: ctx.env,
      timeoutMs: ATTEMPT_LIMIT_MS,
      signal: ctx.signal,
    })
    const endMs = now()
    run.windows.push({
      deviceId: device.id,
      journey: journeyId,
      attempt: n,
      startMs,
      endMs,
    })
    if (result.stopped || ctx.signal.aborted) return { stopped: true }
    const output = readAttemptOutput(outputDir)
    pruneDeviceLogs(outputDir)
    const common = {
      ...base,
      stepTimes: output.stepTimes,
      screensReached: screensReachedFrom(
        output.reached,
        run.screensConfig.hand,
      ),
    }
    if (result.code === 0 && !output.failed && !result.timedOut) {
      ctx.event({ type: "attempt", ...base, status: "passed" })
      return {
        passed: true,
        record: attemptRecord({ ...common, status: "passed" }),
      }
    }
    const probe = await handle.probe()
    const window = { startMs, endMs }
    const server = classify.serverSignals(
      classify.readServerLog(path.join(ctx.runDir, SERVER_LOG)),
      { deviceId: device.id, ...window },
    )
    const verdict = classify.classifyFailure({
      deviceProblem: probe.ok
        ? null
        : (probe.error ?? "The device did not answer."),
      appEvidence: await appEvidence(ctx, entry, window, probe.ok),
      server,
      maestro: result,
      output,
      timeoutMs: ATTEMPT_LIMIT_MS,
    })
    const record = attemptRecord({
      ...common,
      status: "failed",
      class: verdict.class,
      failedStep: output.failed?.label ?? null,
      error: verdict.error,
      screenshot: relativeTo(ctx.runDir, output.screenshot),
      notRunSteps: notRunLabels(journey.flow, output.commands),
    })
    ctx.event({
      type: "attempt",
      ...base,
      status: "failed",
      class: verdict.class,
    })
    return {
      passed: false,
      deviceAnswered: probe.ok,
      retryAfterMs: server.retryAfterMs,
      record,
    }
  }

  async function recover(run, ctx, entry, reason) {
    for (;;) {
      const result = await entry.handle.ensureResponsive()
      if (result.restarted) {
        run.restarts.push({
          deviceId: entry.device.id,
          ts: new Date(now()).toISOString(),
          reason,
        })
        ctx.event({
          type: "device_restarted",
          deviceId: entry.device.id,
          reason,
        })
      }
      if (result.answered || result.exhausted || !result.restarted)
        return result
    }
  }

  function sleep(ms, signal) {
    if (options.sleep) return options.sleep(ms, signal)
    return new Promise((resolve) => {
      if (signal.aborted) return resolve()
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        signal.removeEventListener("abort", done)
        resolve()
      }
      signal.addEventListener("abort", done, { once: true })
    })
  }

  async function runDeviceQueue(run, ctx, entry, journeys) {
    const result = await runQueue({
      deviceId: entry.device.id,
      journeys,
      probeId: PROBE_ID,
      runOne: (journeyId) => {
        if (ctx.signal.aborted) {
          return {
            attempts: [
              notRunRecord(
                journeyId,
                entry.device.id,
                "The run stopped before this journey.",
              ),
            ],
            label: "not_run",
            deviceLost: false,
            stopped: true,
          }
        }
        return runJourney({
          journey: journeyId,
          deviceId: entry.device.id,
          knownBugs: run.knownBugs,
          runAttempt: (n) => runAttempt(run, ctx, entry, journeyId, n),
          recover: (reason) => recover(run, ctx, entry, reason),
          cleanUp: () => cleanUp(ctx, entry),
          wait: (ms) => sleep(ms, ctx.signal),
        })
      },
    })
    run.attempts.push(...result.attempts)
    return result
  }

  function markNotRun(run, ctx, device, error, withProbe = true) {
    const journeys = queueFor(run, ctx, device)
    for (const journeyId of withProbe ? [PROBE_ID, ...journeys] : journeys) {
      run.attempts.push(notRunRecord(journeyId, device.id, error))
    }
  }

  async function probeDevice(run, ctx, entry) {
    const result = await runDeviceQueue(run, ctx, entry, [PROBE_ID])
    if (result.probeFailed) {
      const last = result.attempts.at(-1)
      run.probeFailures.push({
        code: "SETTINGS_PROBE_FAILED",
        message: `The settings probe failed on ${entry.device.id} at "${last.failedStep ?? "the start"}" (${last.class ?? "no class"}): ${last.error ?? "no error text"}`,
        setting: null,
        file: PROBE_FILE,
        deviceId: entry.device.id,
      })
    }
    return {
      ...result,
      passed: !result.probeFailed && !result.stopped && !result.deviceLost,
    }
  }

  // ── Phases ─────────────────────────────────────────────────────────

  // Each lane probes its first device, then stops it and leaves the gate. A
  // probed device that waited for the other lanes held memory and load that
  // a lane still waiting at the gate needed, and the phase could not end.
  async function probing(ctx) {
    const run = startRun(ctx)
    await Promise.all(
      run.lanes.map(async (lane) => {
        const device = lane.devices[0]
        if (ctx.signal.aborted) return
        const entry = await startDevice(run, ctx, device)
        if (!entry.started) {
          lane.probed[0] = false
          if (entry.admitted) {
            markNotRun(
              run,
              ctx,
              device,
              `The device did not start: ${entry.error}`,
            )
          }
          return
        }
        lane.probed[0] = (await probeDevice(run, ctx, entry)).passed
        await stopDevice(ctx, entry)
      }),
    )
    return {
      passed: run.probeFailures.length === 0,
      findings: [...run.probeFailures],
    }
  }

  async function runLane(run, ctx, lane) {
    for (const [index, device] of lane.devices.entries()) {
      const probedEarlier = lane.probed[index]
      if (probedEarlier === false) continue
      const withProbe = probedEarlier !== true
      if (ctx.signal.aborted) {
        markNotRun(
          run,
          ctx,
          device,
          "The run stopped before this device started.",
          withProbe,
        )
        continue
      }
      const entry = await startDevice(run, ctx, device)
      if (!entry.started) {
        const why = entry.admitted
          ? `The device did not start: ${entry.error}`
          : "The run stopped before this device started."
        markNotRun(run, ctx, device, why, withProbe)
        continue
      }
      if (withProbe) {
        const probe = await probeDevice(run, ctx, entry)
        if (probe.probeFailed) {
          ctx.stop("probe_failed", entry.device.id)
          markNotRun(
            run,
            ctx,
            device,
            "The settings probe failed on this device, so this journey did not run.",
            false,
          )
          await stopDevice(ctx, entry)
          continue
        }
        if (!probe.passed) {
          markNotRun(
            run,
            ctx,
            device,
            "The run stopped before this journey.",
            false,
          )
          await stopDevice(ctx, entry)
          continue
        }
      }
      await runDeviceQueue(run, ctx, entry, queueFor(run, ctx, device))
      await stopDevice(ctx, entry)
    }
  }

  // Each admin rate-limit refusal names the attempt whose window holds it.
  function rateLimitRefusals(run, ctx) {
    return classify
      .readServerLog(path.join(ctx.runDir, SERVER_LOG))
      .filter((line) => line.rateLimit)
      .map((line) => {
        const ms = Date.parse(line.ts)
        const window = run.windows.find(
          (entry) =>
            entry.deviceId === line.deviceId &&
            ms >= entry.startMs &&
            ms <= entry.endMs,
        )
        return {
          ts: line.ts,
          field: line.rateLimit.field,
          deviceId: line.deviceId ?? null,
          journey: window?.journey ?? null,
          attempt: window?.attempt ?? null,
        }
      })
  }

  async function journeys(ctx) {
    const run = runs.get(ctx.runId) ?? startRun(ctx)
    try {
      await Promise.all(run.lanes.map((lane) => runLane(run, ctx, lane)))
      const coverage = screenCoverage({
        inventory: run.inventory,
        screensConfig: run.screensConfig,
        settings: ctx.settings,
        notTested: run.notTested,
        plan: run.plan,
        platforms: ctx.selection.platforms,
      })
      const probeFailed = run.probeFailures.length > 0
      return {
        attempts: run.attempts,
        restarts: run.restarts,
        screens: {
          gaps: coverage.gaps,
          notReached: notReachedScreens(run.attempts, run.plan),
          skippedPlatforms: coverage.skippedPlatforms,
        },
        staleKnownBugs: staleKnownBugs(run.knownBugs, run.attempts),
        rateLimitRefusals: rateLimitRefusals(run, ctx),
        ...(probeFailed
          ? {
              stopReason: "probe_failed",
              settingsProbe: { passed: false, findings: run.probeFailures },
            }
          : {}),
      }
    } finally {
      runs.delete(ctx.runId)
    }
  }

  return { probing, journeys }
}

module.exports = { APP_ID, ATTEMPT_LIMIT_MS, PROBE_ID, createJourneyPhases }
