"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortSignal, fetch, module, require */
// The consent text (R2, KTD13, KTD17). `plan` and `run` read the same
// preflight, so a run refuses exactly what the plan named, and the plan has
// no side effect: it only reads git, the devices, the Mac, and one admin read.

const fs = require("node:fs")
const path = require("node:path")

const { COMMAND, EXIT } = require("./contract")
const { holderText, summarizeLock } = require("./lock")

const GB = 1024 ** 3
const DISK_FLOOR_BYTES = 20 * GB
const ADMIN_PREFLIGHT_TIMEOUT_MS = 5000
const ADMIN_PREFLIGHT_BODY = JSON.stringify({
  query: "query ReleaseCheckPreflight { __typename }",
})
const ESTIMATE_MINUTES = Object.freeze({
  builds: 6,
  journeyPerLaneDevice: 1.5,
  speedPerDevice: 3,
})
const NARROWING_FLAGS = Object.freeze([
  "journey",
  "device",
  "platform",
  "skip-speed-pass",
  "reuse-build",
])
const SETUP_DEVICE_ACTIONS = new Set(["missing", "unpinned"])
// A killed run or session can leave its devices up. A run that takes over its
// lock then fails on a busy device and removes the lock that `recover` reads.
const STALE_LOCK_CLEANUP = new Map([
  ["run", "recover"],
  ["session", "session down"],
])

function refusal(code, message) {
  return { code, message }
}

function staleLockCleanup(lock) {
  if (lock.state !== "stale") return null
  return STALE_LOCK_CLEANUP.get(lock.lock?.mode) ?? null
}

function staleLockRefusal(lock) {
  const who = holderText(lock.lock)
  return refusal(
    "STALE_RUN_LOCK",
    lock.lock.mode === "run"
      ? `A killed runner left a stale lock (${who}). Its devices can still run, and its run has no report. Run \`${COMMAND} recover\` first.`
      : `An ended session left a stale lock (${who}), and its device can still run. Run \`${COMMAND} session down\` first. If the lock stays, run \`${COMMAND} recover\`.`,
  )
}

function listText(items) {
  return items.length === 0 ? "none" : items.join(", ")
}

function journeyIdsIn(journeysDir) {
  if (!fs.existsSync(journeysDir)) return []
  return fs
    .readdirSync(journeysDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => name.replace(/\.ya?ml$/, ""))
    .sort()
}

function resolveSelection({ flags = {}, devices, journeyIds }) {
  const refusals = []
  let chosen = devices
  if (flags.platform) {
    chosen = chosen.filter((device) => device.platform === flags.platform)
  }
  if (flags.device) {
    const known = devices.map((device) => device.id)
    const unknown = flags.device.filter((id) => !known.includes(id))
    if (unknown.length > 0) {
      refusals.push(
        refusal(
          "UNKNOWN_DEVICE",
          `\`--device\` names ${listText(unknown)}, which the test devices do not include (${listText(known)}).`,
        ),
      )
    }
    chosen = chosen.filter((device) => flags.device.includes(device.id))
  }
  if (chosen.length === 0) {
    refusals.push(
      refusal(
        "NO_DEVICE_MATCH",
        "No test device matches the `--device` and `--platform` selection.",
      ),
    )
  }
  let journeys = journeyIds
  if (flags.journey) {
    const unknown = flags.journey.filter((id) => !journeyIds.includes(id))
    if (unknown.length > 0) {
      refusals.push(
        refusal(
          "UNKNOWN_JOURNEY",
          `\`--journey\` names ${listText(unknown)}, which has no journey file.`,
        ),
      )
    }
    journeys = journeyIds.filter((id) => flags.journey.includes(id))
  }
  if (journeys.length === 0) {
    refusals.push(
      refusal(
        "NO_JOURNEY_MATCH",
        journeyIds.length === 0
          ? "No journey matches: apps/mobile/release-check/journeys has no journey file yet."
          : "No journey matches the `--journey` selection.",
      ),
    )
  }
  const narrowed = NARROWING_FLAGS.some((flag) => flags[flag] !== undefined)
  return {
    devices: chosen,
    journeys,
    platforms: ["ios", "android"].filter((platform) =>
      chosen.some((device) => device.platform === platform),
    ),
    scope: narrowed ? "partial" : "release",
    refusals,
  }
}

// The iOS lane runs its three simulators one after another, and each Android
// emulator has a lane of its own, so the longest lane sets the journey time.
function estimateRun({ journeys, devices, speedPass }) {
  const iosCount = devices.filter((device) => device.platform === "ios").length
  const laneDevices = Math.max(
    iosCount,
    devices.some((device) => device.platform === "android") ? 1 : 0,
  )
  const parts = {
    builds: ESTIMATE_MINUTES.builds,
    journeys: ESTIMATE_MINUTES.journeyPerLaneDevice * journeys * laneDevices,
    speed: speedPass ? ESTIMATE_MINUTES.speedPerDevice * devices.length : 0,
  }
  const minutes = Math.round(parts.builds + parts.journeys + parts.speed)
  const journeyText =
    journeys === 0
      ? "no journey file exists yet, so this estimate has no journey time"
      : `journeys ${parts.journeys} min`
  return {
    minutes,
    parts,
    text: `about ${minutes} min: builds ${parts.builds} min, ${journeyText}, speed pass ${parts.speed} min`,
  }
}

function nearestExistingDir(dir) {
  let current = path.resolve(dir)
  while (!fs.existsSync(current)) current = path.dirname(current)
  return current
}

function diskFree(dir) {
  const existing = nearestExistingDir(dir)
  const stat = fs.statfsSync(existing)
  return { dir: existing, freeBytes: stat.bavail * stat.bsize }
}

// One read with no credentials. The body is not read, so a large answer
// cannot fill the runner's memory.
async function preflightAdmin({
  url,
  timeoutMs = ADMIN_PREFLIGHT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: ADMIN_PREFLIGHT_BODY,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.body?.cancel()
    const json = /json/i.test(response.headers.get("content-type") ?? "")
    const reachable = response.status === 200 && json
    return {
      url,
      reachable,
      detail: reachable
        ? null
        : `HTTP ${response.status}${json ? "" : ", not JSON"}`,
    }
  } catch (error) {
    const detail =
      error?.name === "TimeoutError"
        ? `no answer within ${timeoutMs / 1000} s`
        : String(error?.cause?.code ?? error?.message ?? error)
    return { url, reachable: false, detail }
  }
}

function deviceStates(configDevices, inventory) {
  return configDevices.map((device) => {
    const entry = inventory.owned.find((owned) => owned.id === device.id)
    let state = "missing"
    if (entry) state = entry.running ? "running" : "shut down"
    return {
      id: device.id,
      platform: device.platform,
      name: device.name ?? device.avd,
      state,
    }
  })
}

function foreignText(device) {
  return device.platform === "ios"
    ? `${device.name} (simulator)`
    : `${device.avd ?? device.serial} (Android)`
}

function setupFacts(setup) {
  const downloads = setup.downloads
    .filter((download) => !download.installed)
    .map((download) => ({
      package: download.package,
      approxMb: download.approxMb,
    }))
  const createsDevices = setup.devices
    .filter((device) => SETUP_DEVICE_ACTIONS.has(device.status))
    .map((device) => device.id)
  return {
    ready: setup.ready,
    problems: setup.problems,
    downloads,
    createsDevices,
    needed:
      setup.problems.length === 0 &&
      (!setup.ready || downloads.length > 0 || createsDevices.length > 0),
    observed: setup.observed,
  }
}

// Reads everything `plan` shows and every reason `run` would refuse. `plan`
// passes no flags, so it describes a release run with its own run command.
async function gatherPreflight(deps, { flags = {}, forRun = false } = {}) {
  const [commit, dirty, lock, setupResult, inventory, sample, admin] =
    await Promise.all([
      deps.git.head(),
      deps.git.dirty(),
      deps.lock.inspect(),
      deps.setup.check(),
      deps.devices.list(),
      deps.host.sample(),
      deps.admin.preflight(),
    ])
  const disk = deps.host.diskFree(deps.home)
  const devicesConfig = deps.config.devices
  const selection = resolveSelection({
    flags,
    devices: devicesConfig.devices,
    journeyIds: deps.journeyIds(),
  })
  const capacity =
    selection.devices.length === 0
      ? { ok: true, lanes: [], load: null, reason: null, message: null }
      : deps.gate.planCapacity({
          sample,
          devices: selection.devices,
          gate: devicesConfig.gate,
        })
  const setup = setupFacts(setupResult)

  const refusals = []
  const expect = flags["expect-commit"]
  if (expect !== undefined && !commit.startsWith(expect)) {
    refusals.push(
      refusal(
        "COMMIT_MISMATCH",
        `HEAD is ${commit}, and \`--expect-commit\` is ${expect}. Check out the commit that the plan showed, or run \`plan\` again.`,
      ),
    )
  }
  if (dirty.length > 0) {
    refusals.push(
      refusal(
        "DIRTY_BUILD_INPUTS",
        `The build inputs have uncommitted changes, so a build would not match commit ${commit.slice(0, 12)}. Commit or remove them: ${dirty.join(", ")}.`,
      ),
    )
  }
  if (lock.state === "held") {
    refusals.push(
      refusal(
        "LOCK_HELD",
        `Another release check holds the lock (${holderText(lock.lock)}). Wait for it to end, or run \`stop\`.`,
      ),
    )
  }
  if (staleLockCleanup(lock)) refusals.push(staleLockRefusal(lock))
  for (const item of setup.problems) {
    refusals.push(
      refusal(
        item.code,
        `${item.message}${item.command ? ` Run: ${item.command}` : ""}`,
      ),
    )
  }
  // The plan's run command carries --allow-setup, so only a run refuses here.
  if (setup.needed && forRun && flags["allow-setup"] !== true) {
    refusals.push(
      refusal(
        "SETUP_NEEDED",
        `Setup must run first (downloads: ${listText(setup.downloads.map((item) => `${item.package}, about ${item.approxMb} MB`))}; devices to create: ${listText(setup.createsDevices)}). Run \`setup\`, or pass \`--allow-setup\`.`,
      ),
    )
  }
  if (!capacity.ok) refusals.push(refusal("HOST_CAPACITY", capacity.message))
  if (disk.freeBytes < DISK_FLOOR_BYTES) {
    refusals.push(
      refusal(
        "DISK_LOW",
        `The volume of ${disk.dir} has ${(disk.freeBytes / GB).toFixed(1)} GB free, and a run needs ${DISK_FLOOR_BYTES / GB} GB.`,
      ),
    )
  }
  if (!admin.reachable) {
    refusals.push(
      refusal(
        "ADMIN_UNREACHABLE",
        `Production admin did not answer the preflight read (${admin.detail}).`,
      ),
    )
  }
  refusals.push(...selection.refusals)

  return {
    commit,
    dirty,
    devices: deviceStates(devicesConfig.devices, inventory),
    otherRunningDevices: deps.devices.runningForeign(inventory),
    inventoryErrors: inventory.errors,
    setup,
    disk: { ...disk, floorBytes: DISK_FLOOR_BYTES },
    host: { sample, capacity },
    lock,
    admin,
    selection,
    estimate: estimateRun({
      journeys: selection.journeys.length,
      devices: selection.devices,
      speedPass: flags["skip-speed-pass"] !== true,
    }),
    runCommand: `${COMMAND} run --yes --expect-commit ${commit}${setup.needed ? " --allow-setup" : ""}`,
    refusals,
  }
}

function lockText(lock) {
  if (lock.state === "free") return "free"
  const who = lock.lock ? holderText(lock.lock) : "an unreadable lock file"
  if (lock.state === "held") return `held (${who})`
  const cleanup = staleLockCleanup(lock)
  if (cleanup) {
    return `stale (${who}; ${lock.reason}). A run refuses until \`${cleanup}\` removes it.`
  }
  return `stale (${who}; ${lock.reason}). The next run takes it over.`
}

function hostText(host) {
  const { sample, capacity } = host
  const reading = sample
    ? `${sample.availableMb} MB free, load ${sample.load1} on ${sample.cores} cores`
    : "the Mac's memory and load could not be read"
  if (!capacity.ok) return `${reading}. ${capacity.message}`
  const startLoad =
    typeof capacity.load === "number"
      ? ` With ${capacity.floorText}, the load is ${capacity.load.toFixed(1)}, and the limit is ${capacity.loadLimit.toFixed(1)}.`
      : ""
  return `${reading}.${startLoad} Lanes that can start now: ${listText(capacity.lanes)}.`
}

function formatPlan(pre) {
  const lines = [`Release check plan for commit ${pre.commit}.`, ""]
  lines.push(
    pre.dirty.length === 0
      ? "Build inputs: no uncommitted changes."
      : `Build inputs: uncommitted changes in ${pre.dirty.join(", ")}.`,
  )
  lines.push("Runner devices:")
  for (const device of pre.devices) {
    lines.push(`- ${device.id} (${device.name}): ${device.state}`)
  }
  lines.push(
    `Other running devices (the run does not touch them): ${listText(pre.otherRunningDevices.map(foreignText))}.`,
  )
  for (const error of pre.inventoryErrors) {
    lines.push(`Device list problem (${error.tool}): ${error.message}`)
  }
  if (pre.setup.downloads.length > 0 || pre.setup.createsDevices.length > 0) {
    lines.push("Setup items:")
    for (const item of pre.setup.downloads) {
      lines.push(`- download ${item.package}, about ${item.approxMb} MB`)
    }
    for (const id of pre.setup.createsDevices) lines.push(`- create ${id}`)
  } else if (pre.setup.problems.length === 0) {
    lines.push("Setup: ready.")
  }
  lines.push(
    `Disk: ${(pre.disk.freeBytes / GB).toFixed(1)} GB free on the volume of ${pre.disk.dir}; the floor is ${pre.disk.floorBytes / GB} GB.`,
  )
  lines.push(`Memory and load: ${hostText(pre.host)}`)
  lines.push(`Lock: ${lockText(pre.lock)}`)
  lines.push(
    `Production admin: ${pre.admin.reachable ? "reachable" : `not reachable (${pre.admin.detail})`}.`,
  )
  lines.push(`Estimate: ${pre.estimate.text}.`)
  lines.push("", "The run:")
  lines.push(
    "- builds one release app for each platform from this commit, in its own worktree under the runner home;",
    "- holds ports 38211, 38212, and 38213 on 127.0.0.1 and ::1 for its read-only server;",
    "- starts its own five test devices, one iOS simulator at a time next to up to two Android emulators, and installs the test app on each;",
    "- at the end stops its server and only its own test devices, and writes the report.",
  )
  if (pre.setup.needed) {
    lines.push(
      "- runs setup first (`--allow-setup`): it downloads and creates the setup items above.",
    )
  }
  lines.push("", `Run command: ${pre.runCommand}`)
  if (pre.refusals.length > 0) {
    lines.push("", "A run would refuse now:")
    for (const item of pre.refusals)
      lines.push(`- ${item.code}: ${item.message}`)
  }
  return lines.join("\n")
}

function planJson(pre) {
  return {
    mode: "plan",
    commit: pre.commit,
    dirtyBuildInputs: pre.dirty,
    devices: pre.devices,
    otherRunningDevices: pre.otherRunningDevices.map((device) => ({
      platform: device.platform,
      name: device.name ?? device.avd ?? device.serial,
    })),
    setup: {
      ready: pre.setup.ready,
      downloads: pre.setup.downloads,
      createsDevices: pre.setup.createsDevices,
      problems: pre.setup.problems,
    },
    disk: {
      dir: pre.disk.dir,
      freeGb: Number((pre.disk.freeBytes / GB).toFixed(1)),
      floorGb: pre.disk.floorBytes / GB,
    },
    host: {
      availableMb: pre.host.sample?.availableMb ?? null,
      load1: pre.host.sample?.load1 ?? null,
      cores: pre.host.sample?.cores ?? null,
      startCheckLoad:
        typeof pre.host.capacity.load === "number"
          ? Number(pre.host.capacity.load.toFixed(2))
          : null,
      loadLimit: pre.host.capacity.loadLimit ?? null,
      lanes: pre.host.capacity.lanes,
      ok: pre.host.capacity.ok,
      message: pre.host.capacity.message,
    },
    lock: summarizeLock(pre.lock),
    admin: pre.admin,
    journeys: pre.selection.journeys.length,
    estimate: { minutes: pre.estimate.minutes, text: pre.estimate.text },
    runCommand: pre.runCommand,
    refusals: pre.refusals,
    text: formatPlan(pre),
  }
}

/** The mode handler for `plan [--json]`; it always exits 0. */
async function planCommand(command, deps) {
  const pre = await gatherPreflight(deps)
  deps.out(
    command.flags.json
      ? JSON.stringify(planJson(pre), null, 2)
      : formatPlan(pre),
  )
  return EXIT.passed
}

module.exports = {
  diskFree,
  formatPlan,
  gatherPreflight,
  journeyIdsIn,
  planCommand,
  preflightAdmin,
  staleLockCleanup,
  staleLockRefusal,
}
