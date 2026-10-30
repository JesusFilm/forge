import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import process from "node:process"
import os from "node:os"
import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { URL, fileURLToPath } from "node:url"

const states = ["passed", "failed", "blocked", "not-run"]
const instructionPaths = [
  "AGENTS.md",
  "CLAUDE.md",
  "apps/AGENTS.md",
  "apps/tv/CLAUDE.md",
  "apps/tv/harnesses/development/HARNESS.md",
  "apps/tv/harnesses/development/EVALUATION.md",
]
const staticGates = ["typecheck", "lint", "unit", "format"]
const sourcePaths = [
  "apps/tv",
  "packages/admin-graphql",
  "packages/watch-url-policy",
  "patches",
  "package.json",
  "pnpm-lock.yaml",
]
const outputPrefix = "apps/tv/test-results/development-harness/"
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex")
const readJson = (file) => {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > 1024 * 1024)
    throw new HarnessError(
      "JSON inputs must be regular files no larger than 1 MiB.",
    )
  return JSON.parse(fs.readFileSync(file, "utf8"))
}
const hasControls = (value) =>
  [...value].some((character) => character.charCodeAt(0) < 32)

export class HarnessError extends Error {}

export function command(root, program, args, timeout = 15000) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      CI: "1",
      EXPO_TV: "1",
      COREPACK_ENABLE_NETWORK: "0",
    },
  })
  return {
    code: result.status,
    signal: result.signal,
    output: result.stdout ?? "",
    unavailable: result.error?.code === "ENOENT",
  }
}

function git(root, ...args) {
  const result = command(root, "git", args)
  if (result.code !== 0)
    throw new HarnessError(
      "Git inspection failed; check the selected checkout.",
    )
  return result.output
}

export function relativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "." || part === "..") ||
    hasControls(value)
  )
    throw new HarnessError("Use a repository-relative path without traversal.")
  return value
}

function fileDigest(root, relative) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return null
  const stat = fs.lstatSync(file)
  return stat.isSymbolicLink()
    ? sha(`link:${fs.readlinkSync(file)}`)
    : hashFile(file)
}

function hashFile(file) {
  const hash = crypto.createHash("sha256")
  const descriptor = fs.openSync(file, "r")
  const buffer = Buffer.alloc(64 * 1024)
  try {
    let bytes
    while ((bytes = fs.readSync(descriptor, buffer)) > 0)
      hash.update(buffer.subarray(0, bytes))
    return hash.digest("hex")
  } finally {
    fs.closeSync(descriptor)
  }
}

function listed(root, ...args) {
  return git(root, ...args)
    .split("\0")
    .filter(Boolean)
}

export function sourceDigest(root) {
  const environmentFiles = fs
    .readdirSync(path.join(root, "apps/tv"))
    .filter((name) => /^\.env(?:\.|$)/.test(name))
    .map((name) => `apps/tv/${name}`)
  const files = [
    ...new Set([
      ...listed(
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...sourcePaths,
      ),
      ...environmentFiles,
    ]),
  ]
    .filter((file) => !file.endsWith(".md") && !file.startsWith(outputPrefix))
    .sort()
  const environment = Object.keys(process.env)
    .filter((key) => key.startsWith("EXPO_PUBLIC_") || key === "EXPO_TV")
    .sort()
    .map((key) => [key, sha(process.env[key])])
  return sha(
    JSON.stringify({
      files: files.map((file) => [file, fileDigest(root, file)]),
      environment,
    }),
  )
}

function instructions(root) {
  const values = Object.fromEntries(
    instructionPaths.map((file) => [file, fileDigest(root, file)]),
  )
  const skill = path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "skills/forge-tv-app/SKILL.md",
  )
  values["skill:forge-tv-app"] = fs.existsSync(skill) ? hashFile(skill) : null
  for (const name of ["HARNESS.md", "EVALUATION.md"]) {
    const file = fileURLToPath(new URL(`../${name}`, import.meta.url))
    values[`harness:${name}`] = fs.existsSync(file) ? hashFile(file) : null
  }
  return values
}

function dirtyFiles(root) {
  return [
    ...new Set([
      ...listed(root, "diff", "HEAD", "--name-only", "-z"),
      ...listed(root, "ls-files", "--others", "--exclude-standard", "-z"),
    ]),
  ].filter((file) => !file.startsWith(outputPrefix))
}

export function validateTask(task) {
  const keys = [
    "id",
    "objective",
    "kind",
    "platform",
    "targets",
    "allowedPaths",
    "acceptance",
    "agentModel",
  ]
  if (
    !task ||
    typeof task !== "object" ||
    Array.isArray(task) ||
    Object.keys(task).some((key) => !keys.includes(key))
  )
    throw new HarnessError("Task contains unsupported fields.")
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(task.id ?? "") ||
    typeof task.objective !== "string" ||
    !task.objective.trim()
  )
    throw new HarnessError("Task requires a safe id and an objective.")
  if (
    !["docs", "logic", "ui", "native"].includes(task.kind) ||
    !["apple-tv", "android-tv", "both"].includes(task.platform)
  )
    throw new HarnessError("Select a supported task kind and TV platform.")
  if (
    !Array.isArray(task.acceptance) ||
    !task.acceptance.length ||
    task.acceptance.some(
      (item) =>
        !item ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id ?? "") ||
        typeof item.description !== "string" ||
        !item.description.trim(),
    ) ||
    new Set(task.acceptance.map((item) => item.id)).size !==
      task.acceptance.length
  )
    throw new HarnessError(
      "Provide distinct acceptance ids with observable descriptions.",
    )
  const scopes = task.allowedPaths ?? ["apps/tv/"]
  if (!Array.isArray(scopes) || !scopes.length)
    throw new HarnessError("Task scope is required.")
  scopes.forEach(relativePath)
  if (scopes.some((scope) => scope === "/" || scope.startsWith(".git")))
    throw new HarnessError("Git metadata cannot be a task scope.")
  const targets = task.targets ?? {}
  if (
    typeof targets !== "object" ||
    Array.isArray(targets) ||
    Object.keys(targets).some(
      (key) => !["appleTvSimulatorId", "androidSerial"].includes(key),
    ) ||
    Object.values(targets).some(
      (value) => typeof value !== "string" || !value || hasControls(value),
    )
  )
    throw new HarnessError("Use explicit simulator and ADB target identifiers.")
  if (task.agentModel !== undefined && typeof task.agentModel !== "string")
    throw new HarnessError("agentModel must be a string.")
  return { ...task, allowedPaths: scopes, targets }
}

export function requiredGates(task) {
  const gates =
    task.kind === "docs" ? ["format"] : ["typecheck", "lint", "unit", "format"]
  if (["ui", "native"].includes(task.kind)) {
    const platforms =
      task.platform === "both" ? ["apple-tv", "android-tv"] : [task.platform]
    for (const platform of platforms) {
      gates.push(`runtime:${platform}`, `performance:${platform}`)
      if (task.kind === "native") gates.push(`native-build:${platform}`)
    }
  }
  return [...gates, ...task.acceptance.map((item) => `acceptance:${item.id}`)]
}

export function assessCapacity(availableGiB, phase) {
  const requiredGiB = phase === "native" ? 12 : phase === "checks" ? 1 : 0.25
  return {
    id: "disk",
    status: availableGiB >= requiredGiB ? "passed" : "blocked",
    availableGiB,
    requiredGiB,
  }
}

export function assessAppleTarget(devices, id) {
  for (const [runtime, entries] of Object.entries(devices)) {
    const device = entries.find((entry) => entry.udid === id)
    if (
      device &&
      /tvOS/i.test(runtime) &&
      (/Apple TV.*4K|4K.*Apple TV/i.test(device.name) ||
        device.deviceTypeIdentifier?.includes("Apple-TV-4K")) &&
      !/1080/i.test(`${device.name} ${device.deviceTypeIdentifier}`) &&
      device.isAvailable
    )
      return {
        id: "apple-tv-target",
        status: "passed",
        target: id,
        name: device.name,
        runtime,
        state: device.state,
      }
  }
  return {
    id: "apple-tv-target",
    status: "blocked",
    reason: "Select an available Apple TV 4K simulator UUID.",
  }
}

export function assessAndroidTarget(list, serial, isTv, abi) {
  const connected = list
    .split("\n")
    .some(
      (line) =>
        line.split(/\s+/)[0] === serial && line.split(/\s+/)[1] === "device",
    )
  return connected && isTv && abi
    ? { id: "android-tv-target", status: "passed", target: serial, abi }
    : {
        id: "android-tv-target",
        status: "blocked",
        reason:
          "Select one authorized, connected TV device and verify its ABI.",
      }
}

export function preflight(root, task, phase = "checks") {
  if (!["checks", "runtime", "native"].includes(phase))
    throw new HarnessError("Unknown preflight phase.")
  const stat = fs.statfsSync(root)
  const checks = [assessCapacity((stat.bavail * stat.bsize) / 1024 ** 3, phase)]
  const pin = readJson(path.join(root, "package.json")).packageManager
  const pnpm = command(root, "corepack", ["pnpm", "--version"])
  const candidateVersion = pnpm.output.trim().split(/\r?\n/).at(-1)
  const version = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(candidateVersion ?? "")
    ? candidateVersion
    : "unavailable"
  checks.push({
    id: "node",
    status:
      Number(process.versions.node.split(".")[0]) >= 20 ? "passed" : "blocked",
    version: process.version,
  })
  checks.push({
    id: "pnpm",
    status:
      pnpm.code === 0 && pin?.split("+")[0] === `pnpm@${version}`
        ? "passed"
        : "blocked",
    expected: pin,
    version,
  })
  checks.push({
    id: "dependencies",
    status:
      fs.existsSync(path.join(root, "apps/tv/node_modules")) &&
      fs.existsSync(path.join(root, "node_modules"))
        ? "passed"
        : "blocked",
  })
  if (phase !== "checks") {
    const envFile = path.join(root, "apps/tv/.env.local")
    const envText = fs.existsSync(envFile)
      ? fs.readFileSync(envFile, "utf8")
      : ""
    const missing = [
      "EXPO_PUBLIC_GRAPHQL_URL",
      "EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN",
    ].filter((name) => {
      const value =
        process.env[name] ??
        envText.match(
          new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=([^\\n]*)`, "m"),
        )?.[1]
      return !value?.replace(/^["']|["']$/g, "").trim()
    })
    checks.push({
      id: "environment",
      status: missing.length ? "blocked" : "passed",
      missing,
    })
    if (task.platform !== "android-tv") {
      const result = command(root, "xcrun", [
        "simctl",
        "list",
        "devices",
        "available",
        "--json",
      ])
      let devices = {}
      try {
        devices = JSON.parse(result.output).devices ?? {}
      } catch {
        devices = {}
      }
      checks.push(assessAppleTarget(devices, task.targets.appleTvSimulatorId))
    }
    if (task.platform !== "apple-tv") {
      const serial = task.targets.androidSerial
      const devices = command(root, "adb", ["devices"])
      const connected =
        serial &&
        devices.output
          .split("\n")
          .some((line) => line.startsWith(`${serial}\tdevice`))
      const features = connected
        ? command(root, "adb", [
            "-s",
            serial,
            "shell",
            "pm",
            "list",
            "features",
          ]).output
        : ""
      const abi = connected
        ? command(root, "adb", [
            "-s",
            serial,
            "shell",
            "getprop",
            "ro.product.cpu.abilist",
          ]).output.trim()
        : ""
      checks.push(
        assessAndroidTarget(
          devices.output,
          serial,
          features.includes("android.software.leanback"),
          abi,
        ),
      )
    }
  }
  return {
    phase,
    status: checks.every((check) => check.status === "passed")
      ? "passed"
      : "blocked",
    checks,
  }
}

function safeRun(root, directory, creating = false) {
  const relative = relativePath(
    path.relative(root, path.resolve(root, directory)),
  )
  if (
    !relative.startsWith(outputPrefix) ||
    relative.slice(outputPrefix.length).includes("/")
  )
    throw new HarnessError(
      "Run directory must be one direct child of the TV harness results directory.",
    )
  const absolute = path.join(root, relative)
  let existing = creating ? path.dirname(absolute) : absolute
  while (!fs.existsSync(existing)) existing = path.dirname(existing)
  if (fs.realpathSync(existing) !== existing)
    throw new HarnessError("Run directory cannot use symlink redirection.")
  return absolute
}

function save(directory, name, data) {
  const target = path.join(directory, name)
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
    throw new HarnessError("Refusing a redirected report file.")
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  })
  fs.renameSync(temporary, target)
}

export function start(root, rawTask) {
  const task = validateTask(rawTask)
  const directory = safeRun(
    root,
    `${outputPrefix}${task.id}-${crypto.randomUUID()}`,
    true,
  )
  const baseline = {
    head: git(root, "rev-parse", "HEAD").trim(),
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD").trim(),
    dirty: Object.fromEntries(
      dirtyFiles(root).map((file) => [file, fileDigest(root, file)]),
    ),
    instructions: instructions(root),
    harnessDigest: hashFile(fileURLToPath(import.meta.url)),
    taskDigest: sha(JSON.stringify(task)),
  }
  const state = {
    schemaVersion: 1,
    task,
    baseline,
    createdAt: new Date().toISOString(),
    agentModel: task.agentModel ?? "not supplied",
    checks: {},
    repairAttempts: {},
    failedAttempts: {},
    attempts: {},
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  save(directory, "state.json", state)
  return { directory, state }
}

function load(root, directory) {
  const run = safeRun(root, directory)
  if (fs.lstatSync(path.join(run, "state.json")).isSymbolicLink())
    throw new HarnessError("Checkpoint cannot be a symlink.")
  const state = readJson(path.join(run, "state.json"))
  state.task = validateTask(state.task)
  if (state.baseline?.taskDigest !== sha(JSON.stringify(state.task)))
    throw new HarnessError(
      "Task contract changed; review it and start a new run.",
    )
  if (
    state.schemaVersion !== 1 ||
    !/^[a-f0-9]{40,64}$/.test(state.baseline?.head ?? "")
  )
    throw new HarnessError("Invalid run checkpoint.")
  Object.keys(state.baseline.dirty).forEach(relativePath)
  if (state.baseline.harnessDigest !== hashFile(fileURLToPath(import.meta.url)))
    throw new HarnessError(
      "Harness version changed; review it and start a new run.",
    )
  return { run, state }
}

export function scopeChanges(root, state) {
  const committed = listed(
    root,
    "diff",
    state.baseline.head,
    "HEAD",
    "--name-only",
    "-z",
  )
  const changed = [
    ...new Set([
      ...committed,
      ...dirtyFiles(root),
      ...Object.keys(state.baseline.dirty),
    ]),
  ].filter((file) => {
    if (committed.includes(file)) return true
    if (Object.hasOwn(state.baseline.dirty, file))
      return fileDigest(root, file) !== state.baseline.dirty[file]
    return true
  })
  const outside = changed.filter(
    (file) =>
      !state.task.allowedPaths.some((scope) =>
        scope.endsWith("/") ? file.startsWith(scope) : file === scope,
      ),
  )
  return { changed, outside, status: outside.length ? "failed" : "passed" }
}

function formatDigest(root, state) {
  return sha(
    JSON.stringify(
      scopeChanges(root, state)
        .changed.sort()
        .map((file) => [file, fileDigest(root, file)]),
    ),
  )
}

export function runChecks(root, directory, execute = command) {
  const { run, state } = load(root, directory)
  const readiness = preflight(root, state.task)
  if (readiness.status !== "passed") {
    save(run, "preflight.json", readiness)
    return readiness
  }
  if (scopeChanges(root, state).status !== "passed")
    throw new HarnessError(
      "New changes outside declared scope require review before checks.",
    )
  if (
    JSON.stringify(instructions(root)) !==
    JSON.stringify(state.baseline.instructions)
  )
    throw new HarnessError(
      "Instructions changed; review them and start a new run.",
    )
  const digest = sourceDigest(root)
  const formatFiles = scopeChanges(root, state).changed.filter((file) =>
    fs.existsSync(path.join(root, file)),
  )
  const checks = {
    typecheck: ["--filter", "@forge/tv", "typecheck"],
    lint: ["--filter", "@forge/tv", "lint"],
    unit: ["--filter", "@forge/tv", "exec", "jest", "--runInBand"],
    format: [
      "exec",
      "prettier",
      "--check",
      "--ignore-unknown",
      "--",
      ...(formatFiles.length ? formatFiles : ["apps/tv/harnesses/development"]),
    ],
  }
  for (const id of requiredGates(state.task).filter((gate) =>
    Object.hasOwn(checks, gate),
  )) {
    const inputDigest = id === "format" ? formatDigest(root, state) : digest
    if (
      state.checks[id]?.status === "passed" &&
      state.checks[id].inputDigest === inputDigest
    )
      continue
    const attempts = state.failedAttempts[id] ?? 0
    if (attempts >= 3) {
      state.checks[id] = {
        status: "blocked",
        reason: "Initial attempt and two repairs exhausted.",
        sourceDigest: digest,
      }
      continue
    }
    const began = Date.now()
    const result = execute(root, "corepack", ["pnpm", ...checks[id]], 300000)
    state.attempts[id] = (state.attempts[id] ?? 0) + 1
    if (attempts > 0)
      state.repairAttempts[id] = (state.repairAttempts[id] ?? 0) + 1
    state.failedAttempts[id] = result.code === 0 ? 0 : attempts + 1
    state.checks[id] = {
      status:
        result.code === 0
          ? "passed"
          : result.unavailable
            ? "blocked"
            : "failed",
      sourceDigest: digest,
      inputDigest,
      exitCode: result.code,
      signal: result.signal,
      durationMs: Date.now() - began,
      command: ["corepack", "pnpm", ...checks[id]],
    }
    save(run, "state.json", state)
  }
  save(run, "state.json", state)
  return {
    phase: "static",
    status: Object.values(state.checks).every(
      (check) => check.status === "passed",
    )
      ? "passed"
      : "failed",
    checks: state.checks,
  }
}

export function evaluate(root, directory, evidence = {}) {
  const { run, state } = load(root, directory)
  const digest = sourceDigest(root)
  const scope = scopeChanges(root, state)
  const readiness = preflight(
    root,
    state.task,
    state.task.kind === "native"
      ? "native"
      : state.task.kind === "ui"
        ? "runtime"
        : "checks",
  )
  const gates = [
    { id: "preflight", ...readiness },
    { id: "scope", status: scope.status, outside: scope.outside },
    {
      id: "instructions",
      status:
        JSON.stringify(instructions(root)) ===
        JSON.stringify(state.baseline.instructions)
          ? "passed"
          : "blocked",
    },
  ]
  const records = evidence.gates ?? []
  if (
    !Array.isArray(records) ||
    new Set(records.map((entry) => entry.id)).size !== records.length
  )
    throw new HarnessError("Evidence gates must be a distinct list.")
  for (const id of requiredGates(state.task)) {
    const automated = state.checks[id]
    if (staticGates.includes(id)) {
      const current = id === "format" ? formatDigest(root, state) : digest
      gates.push(
        automated
          ? {
              id,
              ...automated,
              status:
                automated.inputDigest === current
                  ? automated.status
                  : "blocked",
              basis: "command-exit",
            }
          : { id, status: "not-run" },
      )
      continue
    }
    const record = records.find((entry) => entry.id === id)
    if (!record) {
      gates.push({ id, status: "not-run" })
      continue
    }
    if (!states.includes(record.status))
      throw new HarnessError("Invalid evidence status.")
    const gate = {
      id,
      status: record.status,
      declaredStatus: record.status,
      basis: "judge-attestation",
      judge: evidence.judge,
      observed: record.observed,
      artifacts: [],
    }
    const platform = id.split(":")[1]
    const target =
      platform === "apple-tv"
        ? state.task.targets.appleTvSimulatorId
        : state.task.targets.androidSerial
    if (
      evidence.sourceDigest !== digest ||
      typeof evidence.judge !== "string" ||
      !evidence.judge.trim() ||
      typeof record.observed !== "string" ||
      !record.observed.trim() ||
      ((id.startsWith("runtime:") ||
        id.startsWith("performance:") ||
        id.startsWith("native-build:")) &&
        (!target || record.target !== target))
    )
      gate.status = "blocked"
    if (
      (!Array.isArray(record.evidence) || !record.evidence.length) &&
      gate.status !== "failed"
    )
      gate.status = "blocked"
    for (const relative of record.evidence ?? []) {
      relativePath(relative)
      const file = path.join(run, relative)
      if (
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile() ||
        !fs.statSync(file).size ||
        !fs.realpathSync(file).startsWith(run + path.sep)
      ) {
        if (gate.status !== "failed") gate.status = "blocked"
        continue
      }
      const digestNow = hashFile(file)
      const previous = state.evidenceDigests?.[relative]
      if (previous && previous !== digestNow) gate.status = "failed"
      gate.artifacts.push({ path: relative, sha256: digestNow })
    }
    gates.push(gate)
  }
  state.evidenceDigests ??= {}
  for (const gate of gates)
    for (const artifact of gate.artifacts ?? [])
      state.evidenceDigests[artifact.path] ??= artifact.sha256
  const status = gates.some((gate) => gate.status === "failed")
    ? "failed"
    : gates.some((gate) => gate.status !== "passed")
      ? "blocked"
      : "passed"
  const report = {
    schemaVersion: 1,
    phase: "acceptance",
    status,
    generatedAt: new Date().toISOString(),
    taskId: state.task.id,
    taskDigest: state.baseline.taskDigest,
    gitHead: git(root, "rev-parse", "HEAD").trim(),
    sourceDigest: digest,
    instructionDigests: instructions(root),
    harnessDigest: hashFile(fileURLToPath(import.meta.url)),
    node: process.version,
    packageManager: readJson(path.join(root, "package.json")).packageManager,
    agentModel: state.agentModel,
    gates,
    attempts: state.attempts,
    repairAttempts: state.repairAttempts,
    nextAction:
      status === "passed"
        ? "Review the recorded evidence and hand off within the authorized task."
        : "Resolve failed/blocked gates or collect missing evidence; publishing remains separate.",
  }
  save(run, "state.json", state)
  save(run, "report.json", report)
  return report
}

export function main(args) {
  const [action, input, option] = args
  if (!action || ["help", "--help", "-h"].includes(action))
    return {
      usage: [
        "node apps/tv/harnesses/development/scripts/harness.mjs start <task.json>",
        "node apps/tv/harnesses/development/scripts/harness.mjs preflight <run-dir> [checks|runtime|native]",
        "node apps/tv/harnesses/development/scripts/harness.mjs check <run-dir>",
        "node apps/tv/harnesses/development/scripts/harness.mjs evaluate <run-dir> [evidence.json]",
      ],
    }
  const root = fs.realpathSync(
    git(process.cwd(), "rev-parse", "--show-toplevel").trim(),
  )
  if (readJson(path.join(root, "apps/tv/package.json")).name !== "@forge/tv")
    throw new HarnessError(
      "Run from the selected Forge checkout containing apps/tv.",
    )
  if (!input) throw new HarnessError("An input path is required.")
  if (
    args.length > 3 ||
    (["start", "check"].includes(action) && option !== undefined)
  )
    throw new HarnessError("Unexpected command arguments. Use help.")
  if (action === "start") {
    const { directory } = start(root, readJson(path.resolve(input)))
    return {
      status: "not-run",
      repository: root,
      run: directory,
      sourceDigest: sourceDigest(root),
      nextAction:
        "Run preflight, implement the task, run checks, then collect acceptance evidence.",
    }
  }
  if (action === "preflight") {
    const { run, state } = load(root, input)
    const result = preflight(root, state.task, option ?? "checks")
    save(run, "preflight.json", result)
    return result
  }
  if (action === "check") return runChecks(root, input)
  if (action === "evaluate")
    return evaluate(root, input, option ? readJson(path.resolve(option)) : {})
  throw new HarnessError("Unknown action. Use help.")
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = main(process.argv.slice(2))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode =
      result.status === "failed" ? 1 : result.status === "blocked" ? 2 : 0
  } catch (error) {
    console.error(
      error instanceof HarnessError
        ? error.message
        : "Harness could not read or write its inputs. Check JSON, paths, tools and disk space.",
    )
    process.exitCode = 2
  }
}
