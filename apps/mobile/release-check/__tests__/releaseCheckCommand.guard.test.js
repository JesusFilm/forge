/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// The `/qa-release-check` command is what a QA engineer's Claude follows. A mode,
// flag, or field name that drifts from the runner breaks it with no other test.
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { MODES, parseArgs } = require("../lib/contract")
const { createDeps, runCommand, statusCommand } = require("../lib/lifecycle")
const { readJson } = require("../lib/lists")
const lockLib = require("../lib/lock")
const { planCommand } = require("../lib/plan")
const { MARKDOWN_FILE } = require("../lib/report/summary")
const runFolder = require("../lib/runFolder")

const RELEASE_CHECK_DIR = path.join(__dirname, "..")
const COMMAND_FILE = path.join(
  RELEASE_CHECK_DIR,
  "../../..",
  ".claude/commands/qa-release-check.md",
)
const COMMAND = fs.readFileSync(COMMAND_FILE, "utf8")
const QA_COMMAND = fs.readFileSync(
  path.join(RELEASE_CHECK_DIR, "../../..", ".claude/commands/qa-runner.md"),
  "utf8",
)
const SCHEMA = readJson(
  path.join(RELEASE_CHECK_DIR, "schema", "summary.schema.json"),
)
const DEVICES = readJson(path.join(RELEASE_CHECK_DIR, "config", "devices.json"))
const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const GB = 1024 ** 3

// Status words the command compares with. Each one must be a string literal
// that the runner code writes, which a test below checks.
const STATUS_VALUES = [
  "ended",
  "refused",
  "running",
  "starting",
  "stale",
  "held",
  "free",
]
// `checks.log` is a summary field, so `.log` is not a file extension here.
const NOT_FIELDS = new Set(["maestro", "runner.log"])

const FIELD_LIKE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/
const FILE_NAME = /\.(?:md|json|jsonl|html|yaml|mjs|js)$/
const STATUS_PATH = /\b(?:run|lock)\.[a-z][A-Za-z0-9]*\b/g

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function flagsOf(spec) {
  const own = Object.keys(spec.flags ?? {})
  return [...own, ...Object.values(spec.subcommands ?? {}).flatMap(flagsOf)]
}

const ALL_FLAGS = new Set(Object.values(MODES).flatMap(flagsOf))

function unknownModeForms(text) {
  const found = []
  const forms = text.matchAll(/cli\.mjs\s+([a-z][a-z-]*)([^`\n]*)/g)
  for (const [, mode, rest] of forms) {
    if (!Object.hasOwn(MODES, mode)) {
      found.push(mode)
      continue
    }
    const spec = MODES[mode]
    const sub = rest.trim().split(/\s+/)[0]
    if (spec.subcommands && !Object.hasOwn(spec.subcommands, sub)) {
      found.push(`${mode} ${sub}`)
      continue
    }
    const allowed = flagsOf(spec.subcommands ? spec.subcommands[sub] : spec)
    for (const [flag] of rest.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) {
      if (!allowed.includes(flag)) found.push(`${mode} ${flag}`)
    }
  }
  return found
}

function unknownFlags(text) {
  return [...text.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)]
    .map(([flag]) => flag)
    .filter((flag) => !ALL_FLAGS.has(flag))
}

function namesOfValue(value, prefix, names) {
  if (Array.isArray(value)) {
    for (const item of value) namesOfValue(item, prefix, names)
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const name = prefix ? `${prefix}.${key}` : key
      names.add(key)
      names.add(name)
      namesOfValue(item, name, names)
    }
  }
  return names
}

function namesOfSchema(schema, prefix, names) {
  const ref = schema.$ref?.replace("#/$defs/", "")
  const node = ref ? { ...SCHEMA.$defs[ref], ...schema } : schema
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key
    names.add(key)
    names.add(name)
    namesOfSchema(child, name, names)
  }
  if (node.items) namesOfSchema(node.items, prefix, names)
  return names
}

function enumValues(node, values = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) enumValues(item, values)
  } else if (node && typeof node === "object") {
    for (const item of node.enum ?? []) {
      if (typeof item === "string") values.add(item)
    }
    for (const item of Object.values(node)) enumValues(item, values)
  }
  return values
}

function fieldReferences(text) {
  const spans = [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map(([, span]) =>
    span.trim(),
  )
  const values = new Set([
    ...Object.keys(MODES),
    ...enumValues(SCHEMA),
    ...STATUS_VALUES,
    ...NOT_FIELDS,
  ])
  const fromSpans = spans.filter(
    (span) =>
      FIELD_LIKE.test(span) && !FILE_NAME.test(span) && !values.has(span),
  )
  const fromCode = [...text.matchAll(STATUS_PATH)]
    .map(([name]) => name)
    .filter((name) => !FILE_NAME.test(name))
  return [...new Set([...fromSpans, ...fromCode])]
}

function stubDeps({ setup, admin }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-command-"))
  tempDirs.push(home)
  const out = []
  const deps = createDeps({
    home,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    out: (text) => out.push(text),
    err: () => {},
    stdin: { isTTY: false },
    journeyIds: () => ["cold-launch-home"],
    spawnDetached: () => {},
    git: { head: async () => COMMIT, dirty: async () => [] },
    setup: { check: async () => setup },
    devices: {
      list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
      runningForeign: () => [],
    },
    host: {
      sample: async () => ({ availableMb: 64000, load1: 0.5, cores: 12 }),
      diskFree: () => ({ dir: home, freeBytes: 200 * GB }),
    },
    admin: { preflight: async () => admin },
  })
  return { deps, out }
}

function setupResult(downloads) {
  return {
    ready: downloads.length === 0,
    check: true,
    problems: [],
    notes: [],
    devices: DEVICES.devices.map((device) => ({ id: device.id, status: "ok" })),
    downloads,
    actions: [],
    observed: { hostTimezone: "Etc/UTC", xcode: "26.5" },
  }
}

// One plan with a refusal and a setup download fills every plan field. A run
// with --detach and then `status --json` give the other two outputs.
async function runnerOutputs() {
  const planned = stubDeps({
    setup: setupResult([
      { package: "system-images", approxMb: 1700, installed: false },
    ]),
    admin: { url: "u", reachable: false, detail: "offline" },
  })
  await planCommand(parseArgs(["plan", "--json"]), planned.deps)
  const plan = JSON.parse(planned.out.at(-1))

  const started = stubDeps({
    setup: setupResult([]),
    admin: { url: "u", reachable: true, detail: null },
  })
  const runArgs = ["run", "--yes", "--expect-commit", COMMIT, "--detach"]
  expect(await runCommand(parseArgs(runArgs), started.deps)).toBe(0)
  const detached = JSON.parse(started.out.at(-1))
  await statusCommand(parseArgs(["status", "--json"]), started.deps)
  const status = JSON.parse(started.out.at(-1))
  return { plan, detached, status }
}

async function knownNames() {
  const { plan, detached, status } = await runnerOutputs()
  const names = new Set()
  for (const output of [plan, detached, status]) namesOfValue(output, "", names)
  return namesOfSchema(SCHEMA, "", names)
}

describe("the /qa-release-check command", () => {
  it("names only runner modes, and only each mode's own flags", () => {
    expect(unknownModeForms(COMMAND)).toEqual([])
    expect(unknownFlags(COMMAND)).toEqual([])
  })

  it("fails on a made-up mode or flag (positive control)", () => {
    const broken = `${COMMAND}\n\`node apps/mobile/release-check/cli.mjs launch\`\n\`node apps/mobile/release-check/cli.mjs status --watch\` \`--turbo\``
    expect(unknownModeForms(broken)).toEqual([
      ...unknownModeForms(COMMAND),
      "launch",
      "status --watch",
    ])
    expect(unknownFlags(broken)).toEqual([
      ...unknownFlags(COMMAND),
      "--watch",
      "--turbo",
    ])
  })

  it("names only fields that plan --json, status --json, or the summary schema produce", async () => {
    const known = await knownNames()
    expect(fieldReferences(COMMAND).filter((name) => !known.has(name))).toEqual(
      [],
    )
  })

  it("reads the field names from the command, and fails on a made-up field (positive control)", async () => {
    const known = await knownNames()
    expect(fieldReferences(COMMAND)).toEqual(
      expect.arrayContaining([
        "runCommand",
        "estimate.text",
        "setup.downloads",
        "approxMb",
        "run.phase",
        "run.pidState",
        "run.summaryMd",
        "run.refusals",
        "staleKnownBugs",
        "proposedActions",
        "server.rateLimitRefusals",
        "checks.log",
        "failedStep",
      ]),
    )
    const unknownIn = (text) =>
      fieldReferences(text).filter((name) => !known.has(name))
    const broken = `${COMMAND}\nRead \`headline\` and \`run.summaryPath\`, then run.reportPath.`
    expect(unknownIn(broken).sort()).toEqual(
      [
        ...unknownIn(COMMAND),
        "headline",
        "run.summaryPath",
        "run.reportPath",
      ].sort(),
    )
  })

  it("shows the exact keys of the line that run --detach prints", async () => {
    const { detached } = await runnerOutputs()
    expect(Object.keys(detached)).toEqual(["runId", "runDir"])
    expect(COMMAND).toContain('`{ "runId", "runDir" }`')
  })

  it("compares status fields only with words that the runner writes", () => {
    const source = ["lifecycle.js", "lock.js", "modes.js"]
      .map((file) => fs.readFileSync(path.join(RELEASE_CHECK_DIR, "lib", file)))
      .join("\n")
    for (const value of STATUS_VALUES) {
      expect(source).toContain(`"${value}"`)
    }
  })
})

const RUN_ID = "2026-10-24T01-00-00Z-1a2b"
const NEWER_RUN_ID = "2026-10-24T02-00-00Z-3c4d"
const RUNNER_PID = 4242
const RUNNER_START = "Sat Oct 24 01:00:00 2026"

// The shell keeps a single-quoted body as written, so the test runs the same
// text. The argv order is part of the contract, so the match includes it.
function waitLoop(text) {
  const blocks = [...text.matchAll(/```sh\n([\s\S]*?)```/g)]
  if (blocks.length !== 1) return { loop: null, body: null }
  const loop = blocks[0][1]
  if (!/^\s*start=\$\(date \+%s\)$/m.test(loop)) return { loop, body: null }
  const body = loop.match(/node -e '([^']*)' "<runId>" "\$start"/)?.[1]
  return { loop, body: body ?? null }
}

const { loop: WAIT_LOOP, body: WAIT_BODY } = waitLoop(COMMAND)

function waitHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-wait-"))
  tempDirs.push(home)
  return home
}

// The runner's own status.json writer, in the journeys phase.
function recordRun(home, runId, fields = null) {
  const runDir = runFolder.runDirOf(home, runId)
  fs.mkdirSync(runDir, { recursive: true })
  const recorder = runFolder.createRunRecorder(runDir, {
    runId,
    pid: RUNNER_PID,
    startedAt: new Date().toISOString(),
    now: Date.now,
    heartbeatMs: 60_000,
  })
  recorder.write({})
  recorder.phase("journeys")
  if (fields) recorder.write(fields)
  return runDir
}

function takeRunLock(home, runId) {
  return lockLib.acquireLock(home, {
    mode: "run",
    runId,
    pid: RUNNER_PID,
    processStart: async () => RUNNER_START,
  })
}

async function statusOutput(home, { alive }) {
  const out = []
  await statusCommand(parseArgs(["status", "--json"]), {
    home,
    now: Date.now,
    isAlive: () => alive,
    lock: {
      inspect: () =>
        lockLib.inspectLock(home, {
          isAlive: () => alive,
          processStart: async () => RUNNER_START,
        }),
    },
    out: (text) => out.push(text),
  })
  return out.at(-1)
}

function waitExit(input, runId, waitedSec) {
  const start = Math.floor(Date.now() / 1000) - waitedSec
  const result = spawnSync(
    process.execPath,
    ["-e", WAIT_BODY, runId, String(start)],
    { input, encoding: "utf8", timeout: 10_000 },
  )
  return result.status
}

// Each fixture makes at most one end condition true, and `run` pins it, so a
// case can pass only through its own condition.
const WAIT_CASES = [
  {
    name: "a run in the journeys phase keeps the wait going",
    waited: 1000,
    exit: 1,
    run: { phase: "journeys", pidState: "running", summaryMd: null },
    async build(home) {
      recordRun(home, RUN_ID)
      await takeRunLock(home, RUN_ID)
      return { alive: true }
    },
  },
  {
    name: "summary.md ends the wait",
    waited: 60,
    exit: 0,
    run: { phase: "journeys", pidState: "running" },
    async build(home) {
      const runDir = recordRun(home, RUN_ID)
      fs.writeFileSync(path.join(runDir, MARKDOWN_FILE), "# Summary\n")
      await takeRunLock(home, RUN_ID)
      return { alive: true }
    },
  },
  {
    name: "phase ended ends the wait",
    waited: 60,
    exit: 0,
    run: { phase: "ended", pidState: "running", summaryMd: null },
    async build(home) {
      recordRun(home, RUN_ID, { phase: "ended", exitCode: 1 })
      await takeRunLock(home, RUN_ID)
      return { alive: true }
    },
  },
  {
    name: "phase refused ends the wait",
    waited: 60,
    exit: 0,
    run: { phase: "refused", pidState: "running", summaryMd: null },
    async build(home) {
      const deps = {
        home,
        pid: RUNNER_PID,
        now: Date.now,
        err: () => {},
        stdin: { isTTY: false },
      }
      await runCommand(parseArgs(["run", "--run-id", RUN_ID]), deps)
      return { alive: true }
    },
  },
  {
    name: "pidState ended ends the wait before phase ended",
    waited: 60,
    exit: 0,
    run: { phase: "journeys", pidState: "ended", summaryMd: null },
    async build(home) {
      recordRun(home, RUN_ID)
      await takeRunLock(home, RUN_ID)
      return { alive: false }
    },
  },
  {
    name: "a newer run of another runId keeps the wait going",
    waited: 60,
    exit: 1,
    run: { runId: NEWER_RUN_ID, phase: "ended", pidState: "ended" },
    async build(home) {
      recordRun(home, RUN_ID)
      recordRun(home, NEWER_RUN_ID, { phase: "ended", exitCode: 1 })
      return { alive: false }
    },
  },
]

describe("the /qa-release-check wait loop", () => {
  it("has one valid sh block with the node -e body and its runId and start argv", () => {
    expect(WAIT_BODY).toEqual(expect.stringContaining("process.argv[1]"))
    expect(WAIT_BODY).toEqual(expect.stringContaining("process.argv[2]"))
    const syntax = spawnSync("sh", ["-n", "-c", WAIT_LOOP], {
      encoding: "utf8",
    })
    expect(syntax.stderr).toBe("")
    expect(syntax.status).toBe(0)
  })

  it.each(WAIT_CASES)("$name", async ({ build, run, waited, exit }) => {
    const home = waitHome()
    const { alive } = await build(home)
    const output = await statusOutput(home, { alive })
    expect(JSON.parse(output).run).toMatchObject(run)
    expect(waitExit(output, RUN_ID, waited)).toBe(exit)
  })

  it("ends a run in the starting phase only after 900 s", async () => {
    const { detached, status } = await runnerOutputs()
    expect(status.run).toMatchObject({
      runId: detached.runId,
      phase: "starting",
      pidState: null,
      summaryMd: null,
    })
    const output = JSON.stringify(status)
    expect(waitExit(output, detached.runId, 800)).toBe(1)
    expect(waitExit(output, detached.runId, 1000)).toBe(0)
  })

  it("keeps the wait going when no run folder exists (run: null)", async () => {
    const output = await statusOutput(waitHome(), { alive: false })
    expect(JSON.parse(output).run).toBeNull()
    expect(waitExit(output, RUN_ID, 1000)).toBe(1)
  })

  it("ends after 7 hours on a live run and on a failed status read, and not before", async () => {
    const home = waitHome()
    recordRun(home, RUN_ID)
    await takeRunLock(home, RUN_ID)
    const output = await statusOutput(home, { alive: true })
    expect(JSON.parse(output).run).toMatchObject({ pidState: "running" })
    const hours = (count) => Math.round(count * 3600)
    expect(waitExit(output, RUN_ID, hours(6.9))).toBe(1)
    expect(waitExit(output, RUN_ID, hours(7) + 60)).toBe(0)
    expect(waitExit("", RUN_ID, hours(6.9))).toBe(1)
    expect(waitExit("", RUN_ID, hours(7) + 60)).toBe(0)
  })
})

// `/qa-runner` asks for a journey's brief, then hands over to step 7 of
// `/qa-release-check`. The two files name each other's steps by number.
describe("the /qa-runner command", () => {
  it("names only runner modes and flags", () => {
    expect(unknownModeForms(QA_COMMAND)).toEqual([])
    expect(unknownFlags(QA_COMMAND)).toEqual([])
  })

  it("hands over to the Journey step that /qa-release-check still has as step 7", () => {
    expect(QA_COMMAND).toContain('follows step 7 ("Journey")')
    expect(COMMAND).toMatch(/^7\. \*\*Journey\*\* \(`journey <journey id>`\)/m)
  })

  it("keeps the brief at its step 3, which /qa-release-check step 7.1 names", () => {
    expect(COMMAND).toContain("step 3 of `.claude/commands/qa-runner.md`")
    expect(QA_COMMAND).toMatch(/^3\. Get the journey's brief:/m)
  })

  it("covers only the mobile release check, not the web or TV app", () => {
    expect(QA_COMMAND).toContain("`apps/mobile/release-check/`")
    expect(QA_COMMAND).toContain("It does not cover the web app (`apps/web`")
    expect(QA_COMMAND).toContain("the TV app (`apps/tv`)")
  })
})
