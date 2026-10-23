"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global clearTimeout, module, require, setTimeout */
// The host gate (R9, KTD6, AE8). Before each queued device starts, the gate
// reads free memory and the load average, and it lets one device per lane
// run. Five devices at once froze an emulator in the 2026-10-15 pass.

const { run } = require("../proc")
const { toolEnv } = require("./inventory")

const SAMPLE_TIMEOUT_MS = 10000
const MB = 1024 * 1024

/** Free + inactive + speculative pages, the memory macOS can give at once. */
function parseVmStat(text) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1])
  const pages = (label) =>
    Number(new RegExp(`Pages ${label}:\\s+(\\d+)`).exec(text)?.[1])
  const free = pages("free")
  const inactive = pages("inactive")
  const speculative = pages("speculative")
  if (![pageSize, free, inactive, speculative].every(Number.isFinite))
    return null
  return Math.floor(((free + inactive + speculative) * pageSize) / MB)
}

/** `sysctl -n vm.loadavg hw.ncpu` prints `{ 4.57 6.87 10.57 }` and `12`. */
function parseSysctl(text) {
  const load = /\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}/.exec(text)
  const lines = text.trim().split("\n")
  const cores = Number(lines.at(-1))
  if (!load || !Number.isInteger(cores) || cores <= 0) return null
  return { load1: Number(load[1]), cores }
}

async function sampleHost(options = {}) {
  const runChild = options.runChild ?? run
  const env = options.env ?? toolEnv()
  const vmStat = await runChild("/usr/bin/vm_stat", [], {
    env,
    timeoutMs: SAMPLE_TIMEOUT_MS,
  })
  const sysctl = await runChild(
    "/usr/sbin/sysctl",
    ["-n", "vm.loadavg", "hw.ncpu"],
    {
      env,
      timeoutMs: SAMPLE_TIMEOUT_MS,
    },
  )
  const availableMb = vmStat.code === 0 ? parseVmStat(vmStat.stdout) : null
  const load = sysctl.code === 0 ? parseSysctl(sysctl.stdout) : null
  if (availableMb === null || load === null) return null
  return { availableMb, ...load }
}

function estimateFor(device, gate) {
  const estimate = gate.estimates[device.platform]
  if (!estimate) throw new TypeError(`no gate estimate for ${device.platform}`)
  return estimate
}

// A device admitted less than `settleMs` ago counts at its estimate: a
// booting emulator has not taken its memory or load yet, so the sample
// cannot see it.
function decide({ candidate, sample, admitted, now, gate }) {
  if (admitted.some((entry) => entry.lane === candidate.lane)) {
    return { ok: false, reason: "lane_busy" }
  }
  if (!sample) return { ok: false, reason: "no_sample" }
  const settling = admitted.filter(
    (entry) => now - entry.admittedAt < gate.settleMs,
  )
  const pendingMb = settling.reduce(
    (sum, entry) => sum + estimateFor(entry, gate).memoryMb,
    0,
  )
  const pendingLoad = settling.reduce(
    (sum, entry) => sum + estimateFor(entry, gate).load,
    0,
  )
  const estimate = estimateFor(candidate, gate)
  const haveMb = sample.availableMb - pendingMb - gate.reserveMb
  const loadLimit = sample.cores * gate.maxLoadPerCore
  const load = sample.load1 + pendingLoad + estimate.load
  const facts = { needMb: estimate.memoryMb, haveMb, load, loadLimit }
  if (haveMb < estimate.memoryMb)
    return { ok: false, reason: "memory", ...facts }
  if (load > loadLimit) return { ok: false, reason: "load", ...facts }
  return { ok: true, reason: null, ...facts }
}

function describeWait(device, decision, waitedMs) {
  const minutes = Math.round(waitedMs / 60000)
  if (decision.reason === "memory") {
    return `${device.id} waited ${minutes} min for ${decision.needMb} MB of free memory, and the Mac had ${Math.max(0, decision.haveMb)} MB above the reserve`
  }
  if (decision.reason === "load") {
    return `${device.id} waited ${minutes} min for the load average to fall to ${decision.loadLimit.toFixed(1)}, and it stayed at ${decision.load.toFixed(1)} with the device`
  }
  return `${device.id} waited ${minutes} min, and the gate could not read the Mac's memory and load`
}

// The plan floor is one device of each selected platform at the same time;
// below it, `plan` refuses. `load` is the load that the floor check compared
// with `loadLimit`, so `plan` can show the number that `run` refuses on.
function planCapacity({ sample, devices, gate, now = 0 }) {
  const lanes = []
  for (const device of devices) {
    if (!lanes.some((entry) => entry.lane === device.lane)) lanes.push(device)
  }
  const floor = []
  for (const platform of ["ios", "android"]) {
    const first = lanes.find((device) => device.platform === platform)
    if (first) floor.push(first)
  }
  const admitted = []
  let refusal = null
  let floorDecision = null
  for (const device of [
    ...floor,
    ...lanes.filter((device) => !floor.includes(device)),
  ]) {
    const decision = decide({ candidate: device, sample, admitted, now, gate })
    if (floor.includes(device)) floorDecision = decision
    if (!decision.ok) {
      if (floor.includes(device)) refusal = { device, decision }
      break
    }
    admitted.push({ ...device, admittedAt: now })
  }
  const facts = {
    lanes: admitted.map((device) => device.lane),
    floorText: floorText(floor),
    load: floorDecision?.load ?? null,
    loadLimit: floorDecision?.loadLimit ?? null,
  }
  if (refusal) {
    return {
      ok: false,
      ...facts,
      reason: refusal.decision.reason,
      message: describeFloor(refusal, floor, gate),
    }
  }
  return { ok: true, ...facts, reason: null, message: null }
}

function floorText(floor) {
  return floor
    .map((device) =>
      device.platform === "ios" ? "one simulator" : "one emulator",
    )
    .join(" and ")
}

function describeFloor(refusal, floor, gate) {
  const needMb = floor.reduce(
    (sum, device) => sum + estimateFor(device, gate).memoryMb,
    0,
  )
  const what = floorText(floor)
  if (refusal.decision.reason === "load") {
    return `The Mac's load average is too high to run ${what} at the same time: ${refusal.decision.load.toFixed(1)} with them, and the limit is ${refusal.decision.loadLimit.toFixed(1)}.`
  }
  if (refusal.decision.reason === "no_sample") {
    return "The gate could not read the Mac's free memory and load average."
  }
  return `The Mac has too little free memory to run ${what} at the same time: they need ${needMb} MB plus a ${gate.reserveMb} MB reserve.`
}

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener("abort", done)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}

// A wait has no limit while a runner device runs, because that device frees
// its memory when it ends; with none running, a long wait is host_overload.
function createGate(options) {
  const gate = options.gate
  const sample = options.sampleHost ?? (() => sampleHost(options))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const admitted = []

  async function admit(device, { signal } = {}) {
    const started = now()
    let idleWaitMs = 0
    let last = started
    for (;;) {
      if (signal?.aborted) {
        return {
          admitted: false,
          stopReason: "aborted",
          waitedMs: now() - started,
          message: null,
        }
      }
      const reading = await sample()
      const at = now()
      const decision = decide({
        candidate: device,
        sample: reading,
        admitted,
        now: at,
        gate,
      })
      if (decision.ok) {
        admitted.push({ ...device, admittedAt: at })
        return {
          admitted: true,
          stopReason: null,
          waitedMs: at - started,
          message: null,
        }
      }
      idleWaitMs = admitted.length > 0 ? 0 : idleWaitMs + (at - last)
      last = at
      if (idleWaitMs >= gate.waitLimitMs) {
        return {
          admitted: false,
          stopReason: "host_overload",
          waitedMs: at - started,
          message: describeWait(device, decision, idleWaitMs),
        }
      }
      await sleep(gate.pollMs, signal)
    }
  }

  function release(device) {
    const index = admitted.findIndex((entry) => entry.id === device.id)
    if (index !== -1) admitted.splice(index, 1)
  }

  return { admit, release, running: () => admitted.map((entry) => entry.id) }
}

module.exports = {
  createGate,
  decide,
  parseSysctl,
  parseVmStat,
  planCapacity,
  sampleHost,
}
