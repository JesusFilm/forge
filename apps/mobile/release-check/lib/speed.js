"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, AbortSignal, module, require */
// The speed pass (U9, KTD19, R10, R31). It runs after the journeys, one
// device at a time, with three cold launches on fresh installs. The numbers
// are information only, so no failure here may change the run result.

const fs = require("node:fs")
const path = require("node:path")

const inventoryLib = require("./devices/inventory")
const { createEmulator } = require("./devices/android")
const { createSimulator } = require("./devices/ios")
const { APP_ID } = require("./journeys/phases")
const { runMaestro } = require("./journeys/maestro")
const { pruneDeviceLogs, readAttemptOutput } = require("./journeys/results")
const { JOURNEYS_DIR } = require("./lists")
const { abortableSleep, run: runProc } = require("./proc")

const SAMPLES = 3
const FLOWS_DIR = path.join(JOURNEYS_DIR, "_speed")
const COLD_LAUNCH_FLOW = "speed-cold-launch.yaml"
const FIRST_FRAME_FLOW = "speed-first-frame.yaml"
const FIRST_FRAME_ANDROID_FLOW = "speed-first-frame-android.yaml"
const WATCH_LINK = "forgemobile://watch/the-birth-of-jesus"
const MAIN_ACTIVITY = `${APP_ID}/.MainActivity`
// Each time runs from the start of the first step to the end of the second.
// The labels are the ones in the two speed flows.
const SPANS = Object.freeze({
  coldLaunchMs: ["Launch the app", "The first screen shows"],
  homeContentMs: ["Launch the app", "Home content shows"],
  firstFrameMs: [
    "Open the birth of Jesus video",
    "The first video frame shows",
  ],
})
const OPEN_PROMPT_STEPS = Object.freeze([
  "Confirm the open prompt",
  "The first video frame shows after the prompt",
])
const MEASURE_NAMES = Object.freeze({
  coldLaunchMs: "cold launch",
  homeContentMs: "Home content",
  firstFrameMs: "first video frame",
})
const FLOW_LIMIT_MS = 3 * 60_000
const AM_START_TIMEOUT_MS = 60_000
const SIMCTL_TIMEOUT_MS = 60_000
const MEMORY_TIMEOUT_MS = 15_000
const MEMORY_POLL_MS = 2000
// Maestro took 4.7 to 6.4 s to start on Android (measured 2026-10-23).
const LINK_LEAD_MS = 15_000
const KB_PER_MB = 1024

// ── Pure helpers ─────────────────────────────────────────────────────

/** The `TotalTime` line of `am start -W` output in ms, or null. */
function parseTotalTime(text) {
  const match = String(text ?? "").match(/^\s*TotalTime:\s*(\d+)\s*$/m)
  return match ? Number(match[1]) : null
}

/** `{ median, min, max, samples }` of the measured samples, or null for none. */
function timingStats(values) {
  const samples = values.filter(Number.isFinite)
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
  return { median, min: sorted[0], max: sorted.at(-1), samples }
}

/** The app's `TOTAL RSS` in KB from `dumpsys meminfo <package>`, or null. */
function parseMeminfoRssKb(text) {
  const match = String(text ?? "").match(/TOTAL RSS:\s*(\d+)/)
  return match ? Number(match[1]) : null
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The app's resident KB from `ps -ax -o rss=,command=`, or null. Other
// simulators run the same app, so only the executable under this UDID counts.
function simulatorAppRssKb(psText, udid, appFolder) {
  const executable = new RegExp(
    `/Devices/${escapeRegExp(udid)}/.*/${escapeRegExp(appFolder)}/[^/\\s]+(\\s|$)`,
  )
  let peak = null
  for (const line of String(psText ?? "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S.*)$/)
    if (match && executable.test(match[2])) {
      peak = Math.max(peak ?? 0, Number(match[1]))
    }
  }
  return peak
}

function completedStep(commands, label) {
  return commands.find(
    (command) =>
      command.label === label &&
      command.status === "COMPLETED" &&
      Number.isFinite(command.timestamp),
  )
}

/** The ms from the start of step `from` to the end of step `to`, or null. */
function stepSpan(commands, from, to) {
  const start = completedStep(commands, from)
  const end = completedStep(commands, to)
  if (!start || !end) return null
  return end.timestamp + end.ms - start.timestamp
}

// After an iOS open prompt, the app gets the link only when the tap ends, so
// the time starts there and not at the link.
function firstFrameSpan(commands) {
  const direct = stepSpan(commands, ...SPANS.firstFrameMs)
  if (direct !== null) return direct
  const tap = completedStep(commands, OPEN_PROMPT_STEPS[0])
  const frame = completedStep(commands, OPEN_PROMPT_STEPS[1])
  if (!tap || !frame) return null
  return frame.timestamp + frame.ms - (tap.timestamp + tap.ms)
}

// The Android first frame runs from the moment the runner sent the link. A
// wait that started after the link would give a time that is too high.
function linkFirstFrame(commands, sentAt) {
  const wait = completedStep(commands, SPANS.firstFrameMs[1])
  if (!wait) return { ms: null, error: null }
  if (wait.timestamp >= sentAt) {
    return {
      ms: null,
      error:
        "Maestro started its wait after the link, so the time is not exact",
    }
  }
  return { ms: wait.timestamp + wait.ms - sentAt, error: null }
}

function flowProblem(result, output) {
  if (result.timedOut) {
    return `Maestro did not end within ${FLOW_LIMIT_MS / 1000} s`
  }
  if (output.failed) {
    const error = output.failed.error ? `: ${output.failed.error}` : ""
    return `the step "${output.failed.label ?? output.failed.type}" failed${error}`
  }
  if (output.unreadable) return output.unreadable
  if (result.code !== 0) {
    const detail = inventoryLib.lastLine(result.stderr)
    return `Maestro ended with code ${result.code}${detail ? `: ${detail}` : ""}`
  }
  return "the step did not complete"
}

/** One device's entry for `summary.speed.devices` (U8 schema). */
function deviceEntry(deviceId, samples, peakKb, failures) {
  return {
    deviceId,
    coldLaunchMs: timingStats(samples.map((sample) => sample.coldLaunchMs)),
    homeContentMs: timingStats(samples.map((sample) => sample.homeContentMs)),
    firstFrameMs: timingStats(samples.map((sample) => sample.firstFrameMs)),
    peakMemoryMb: peakKb === null ? null : Math.round(peakKb / KB_PER_MB),
    failures,
  }
}

// ── The phase ────────────────────────────────────────────────────────

/** The `speed` phase for `createDeps().phases`; tests inject the layers. */
function createSpeedPhase(options = {}) {
  const flowsDir = options.flowsDir ?? FLOWS_DIR
  const runChild = options.runChild ?? runProc
  const maestro = options.runMaestro ?? runMaestro
  const pollMs = options.memoryPollMs ?? MEMORY_POLL_MS
  const linkLeadMs = options.linkLeadMs ?? LINK_LEAD_MS
  const now = options.now ?? Date.now

  function toolEnv(ctx) {
    return inventoryLib.toolEnv(ctx.env)
  }

  function adb(ctx, handle, args, timeoutMs, signal = ctx.signal) {
    return runChild(
      inventoryLib.toolPaths(toolEnv(ctx)).adb,
      ["-s", handle.serial, ...args],
      { env: toolEnv(ctx), timeoutMs, signal },
    )
  }

  async function openHandle(ctx, device) {
    const env = toolEnv(ctx)
    const pins = ctx.devicesConfig.pins
    if (device.platform === "ios") {
      const list = await (options.listInventory ?? inventoryLib.listInventory)({
        config: ctx.devicesConfig,
        env,
      })
      const udid = list.owned.find((owned) => owned.id === device.id)?.udid
      if (!udid) return null
      return (options.createSimulator ?? createSimulator)(
        { ...device, udid },
        { env, pins },
      )
    }
    const ports = ctx.settings.ports
    const hostPort =
      device.lane === "androidPhone"
        ? ports.hostAndroidPhone
        : ports.hostAndroidTablet
    fs.mkdirSync(path.join(ctx.runDir, "devices"), { recursive: true })
    return (options.createEmulator ?? createEmulator)(
      { ...device, hostPort, devicePort: ports.device },
      {
        env,
        pins,
        logFile: path.join(ctx.runDir, "devices", `${device.id}-emulator.log`),
      },
    )
  }

  // Android: U5's prepareApp clears the app and fixes the notification
  // denial (README section 2). iOS: uninstall and install again.
  async function freshInstall(ctx, device, handle) {
    if (device.platform === "android") return handle.prepareApp(APP_ID)
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
    return handle.install(ctx.artifacts.ios)
  }

  async function amStartTotalTime(ctx, handle) {
    const result = await adb(
      ctx,
      handle,
      ["shell", "am", "start", "-W", "-n", MAIN_ACTIVITY],
      AM_START_TIMEOUT_MS,
    )
    const outcome = inventoryLib.toolOutcome(
      result,
      "am start -W",
      AM_START_TIMEOUT_MS,
    )
    if (!outcome.ok) return { ms: null, error: outcome.error }
    const ms = parseTotalTime(result.stdout)
    if (ms !== null) return { ms, error: null }
    const detail =
      inventoryLib.lastLine(result.stderr) ||
      inventoryLib.lastLine(result.stdout)
    return {
      ms: null,
      error: `am start -W gave no TotalTime${detail ? `: ${detail}` : ""}`,
    }
  }

  async function memoryKb(ctx, device, handle, signal) {
    if (device.platform === "android") {
      const result = await adb(
        ctx,
        handle,
        ["shell", "dumpsys", "meminfo", APP_ID],
        MEMORY_TIMEOUT_MS,
        signal,
      )
      return result.code === 0 ? parseMeminfoRssKb(result.stdout) : null
    }
    const result = await runChild("/bin/ps", ["-ax", "-o", "rss=,command="], {
      env: toolEnv(ctx),
      timeoutMs: MEMORY_TIMEOUT_MS,
      tailBytes: inventoryLib.LIST_TAIL_BYTES,
      signal,
    })
    return result.code === 0
      ? simulatorAppRssKb(
          result.stdout,
          handle.udid,
          path.basename(ctx.artifacts.ios),
        )
      : null
  }

  // Samples the app's memory until the returned stop function runs.
  function watchMemory(ctx, device, handle) {
    const stopper = new AbortController()
    const signal = AbortSignal.any([ctx.signal, stopper.signal])
    let peakKb = null
    const loop = (async () => {
      while (!signal.aborted) {
        const kb = await memoryKb(ctx, device, handle, signal)
        if (kb !== null) peakKb = Math.max(peakKb ?? 0, kb)
        await abortableSleep(pollMs, signal)
      }
    })()
    return async () => {
      stopper.abort()
      await loop
      return peakKb
    }
  }

  // Maestro's Android openLink waits for the screen to settle, so the runner
  // sends the link itself, after Maestro has started to wait.
  async function sendWatchLink(ctx, handle) {
    await abortableSleep(linkLeadMs, ctx.signal)
    const at = now()
    const result = await adb(
      ctx,
      handle,
      [
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        WATCH_LINK,
        APP_ID,
      ],
      AM_START_TIMEOUT_MS,
    )
    const outcome = inventoryLib.toolOutcome(
      result,
      "am start (watch link)",
      AM_START_TIMEOUT_MS,
    )
    return outcome.ok ? { at, error: null } : { at: null, error: outcome.error }
  }

  // `during` runs while Maestro runs, and its result comes back as `during`.
  async function runFlow(ctx, device, handle, n, file, during = null) {
    const outputDir = path.join(
      ctx.runDir,
      "speed",
      device.id,
      String(n),
      path.basename(file, ".yaml"),
    )
    fs.rmSync(outputDir, { recursive: true, force: true })
    fs.mkdirSync(outputDir, { recursive: true })
    const stopMemory = watchMemory(ctx, device, handle)
    const running = maestro({
      platform: device.platform,
      deviceRef: device.platform === "ios" ? handle.udid : handle.serial,
      flowFile: path.join(ctx.runDir, "speed", "flows", file),
      outputDir,
      sourceEnv: ctx.env,
      timeoutMs: FLOW_LIMIT_MS,
      signal: ctx.signal,
    })
    // Maestro and the memory watch must end even when `during` throws.
    let extra = null
    let result
    let peakKb
    try {
      extra = during ? await during() : null
    } finally {
      result = await running
      peakKb = await stopMemory()
    }
    const output = readAttemptOutput(outputDir)
    pruneDeviceLogs(outputDir)
    return {
      output,
      peakKb,
      problem: flowProblem(result, output),
      during: extra,
    }
  }

  async function measureSample(ctx, device, handle, n, notePeak) {
    const sample = {
      coldLaunchMs: null,
      homeContentMs: null,
      firstFrameMs: null,
    }
    const failures = []
    const fail = (measure, why) =>
      failures.push(`Sample ${n}, ${MEASURE_NAMES[measure]}: ${why}.`)
    const done = () => ({ sample, failures })
    const install = async () => {
      const installed = await freshInstall(ctx, device, handle)
      if (!installed.ok && !ctx.signal.aborted) {
        failures.push(
          `Sample ${n}: the fresh install failed: ${installed.error}.`,
        )
      }
      return installed.ok && !ctx.signal.aborted
    }

    if (!(await install())) return done()
    // Maestro starts its driver before its first step, so the Android cold
    // launch is a launch of its own on a second fresh install.
    if (device.platform === "android") {
      const launch = await amStartTotalTime(ctx, handle)
      if (ctx.signal.aborted) return done()
      if (launch.ms === null) fail("coldLaunchMs", launch.error)
      sample.coldLaunchMs = launch.ms
      if (!(await install())) return done()
    }
    const cold = await runFlow(ctx, device, handle, n, COLD_LAUNCH_FLOW)
    notePeak(cold.peakKb)
    if (ctx.signal.aborted) return done()
    const measures =
      device.platform === "ios"
        ? ["coldLaunchMs", "homeContentMs"]
        : ["homeContentMs"]
    for (const measure of measures) {
      sample[measure] = stepSpan(cold.output.commands, ...SPANS[measure])
      if (sample[measure] === null) fail(measure, cold.problem)
    }
    if (sample.homeContentMs === null) {
      fail("firstFrameMs", "not measured, because Home content did not show")
      return done()
    }
    if (device.platform === "android") {
      const frame = await runFlow(
        ctx,
        device,
        handle,
        n,
        FIRST_FRAME_ANDROID_FLOW,
        () => sendWatchLink(ctx, handle),
      )
      notePeak(frame.peakKb)
      if (ctx.signal.aborted) return done()
      if (frame.during.error) {
        fail("firstFrameMs", frame.during.error)
        return done()
      }
      const timed = linkFirstFrame(frame.output.commands, frame.during.at)
      sample.firstFrameMs = timed.ms
      if (timed.ms === null) fail("firstFrameMs", timed.error ?? frame.problem)
      return done()
    }
    const frame = await runFlow(ctx, device, handle, n, FIRST_FRAME_FLOW)
    notePeak(frame.peakKb)
    if (ctx.signal.aborted) return done()
    sample.firstFrameMs = firstFrameSpan(frame.output.commands)
    if (sample.firstFrameMs === null) fail("firstFrameMs", frame.problem)
    return done()
  }

  // A throw here would end the run as runner_error, and R31 forbids that, so
  // every error becomes a named failure of this device.
  async function measureDevice(ctx, device) {
    const samples = []
    const failures = []
    let peakKb = null
    const notePeak = (kb) => {
      if (kb !== null) peakKb = Math.max(peakKb ?? 0, kb)
    }
    // Not ctx.admit: its host_overload stop would change the result (R31).
    const admitted = await ctx.gate.admit(device, { signal: ctx.signal })
    if (!admitted.admitted) {
      const refusal = ctx.signal.aborted
        ? null
        : `the gate did not admit ${device.id}: ${admitted.message ?? admitted.stopReason}`
      return {
        entry: deviceEntry(
          device.id,
          [],
          null,
          refusal ? [`Not measured: ${refusal}.`] : [],
        ),
        refusal,
      }
    }
    let handle = null
    try {
      ctx.server.setLaneDevice(device.lane, device.id)
      handle = await openHandle(ctx, device)
      const boot = handle ? await handle.boot() : null
      if (!handle) {
        failures.push(`Not measured: ${device.id} has no simulator; run setup.`)
      } else if (!boot.ok) {
        failures.push(`Not measured: the device did not start: ${boot.error}.`)
      } else {
        const installed =
          device.platform === "android"
            ? await handle.install(ctx.artifacts.android)
            : { ok: true }
        if (!installed.ok) {
          failures.push(`Not measured: the install failed: ${installed.error}.`)
        }
        for (let n = 1; installed.ok && n <= SAMPLES; n += 1) {
          if (ctx.signal.aborted) break
          const measured = await measureSample(ctx, device, handle, n, notePeak)
          samples.push(measured.sample)
          failures.push(...measured.failures)
          ctx.event({
            type: "speed_sample",
            deviceId: device.id,
            sample: n,
            ...measured.sample,
            failures: measured.failures,
          })
        }
      }
    } catch (error) {
      failures.push(`The speed pass stopped on this device: ${error.message}.`)
    } finally {
      if (handle && !ctx.signal.aborted) {
        const stopped = await handle.shutdown()
        if (!stopped.ok) {
          ctx.event({
            type: "device_not_stopped",
            deviceId: device.id,
            error: stopped.error,
          })
        }
      }
      ctx.gate.release(device)
    }
    return {
      entry: deviceEntry(device.id, samples, peakKb, failures),
      refusal: null,
    }
  }

  // The run reads its own copy of the flows, as the journeys do (R20).
  function copyFlows(ctx) {
    const to = path.join(ctx.runDir, "speed", "flows")
    fs.mkdirSync(to, { recursive: true })
    for (const file of [
      COLD_LAUNCH_FLOW,
      FIRST_FRAME_FLOW,
      FIRST_FRAME_ANDROID_FLOW,
    ]) {
      fs.copyFileSync(path.join(flowsDir, file), path.join(to, file))
    }
  }

  return async function speed(ctx) {
    const devices = []
    try {
      copyFlows(ctx)
    } catch (error) {
      const failure = `Not measured: the speed flows cannot be read: ${error.message}.`
      return {
        devices: ctx.selection.devices.map((device) =>
          deviceEntry(device.id, [], null, [failure]),
        ),
      }
    }
    // After one refusal the gate would make each next device wait as long.
    let refusal = null
    for (const device of ctx.selection.devices) {
      if (ctx.signal.aborted) break
      if (refusal) {
        devices.push(
          deviceEntry(device.id, [], null, [`Not measured: ${refusal}.`]),
        )
        continue
      }
      const measured = await measureDevice(ctx, device)
      devices.push(measured.entry)
      refusal = measured.refusal
    }
    return { devices }
  }
}

module.exports = {
  createSpeedPhase,
  firstFrameSpan,
  linkFirstFrame,
  parseTotalTime,
  simulatorAppRssKb,
  timingStats,
}
