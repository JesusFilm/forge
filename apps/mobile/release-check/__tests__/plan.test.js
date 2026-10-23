/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// `plan` and the run's start check apply one capacity rule (R2, KTD13), and
// `plan --json` carries the text that `plan` prints, from the same reading.
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { parseArgs } = require("../lib/contract")
const { createDeps, runCommand } = require("../lib/lifecycle")
const { readJson } = require("../lib/lists")
const { planCommand } = require("../lib/plan")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const GB = 1024 ** 3
const DEVICES = readJson(path.join(__dirname, "..", "config", "devices.json"))
// The load average of the 2026-10-23 refusal, with room in memory.
const BUSY_MAC = { availableMb: 40000, load1: 7.5, cores: 12 }

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function readySetup() {
  return {
    ready: true,
    check: true,
    problems: [],
    notes: [],
    devices: DEVICES.devices.map((device) => ({ id: device.id, status: "ok" })),
    downloads: [],
    actions: [],
    observed: { hostTimezone: "Etc/UTC", xcode: "26.5" },
  }
}

// The real capacity check runs; only the Mac's readings are fake. Each host
// read takes the next sample, and the last one repeats.
function stubDeps({ androidLoad = 3, samples = [BUSY_MAC] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-plan-"))
  tempDirs.push(home)
  const out = []
  const err = []
  const spawned = []
  let reads = 0
  const devices = {
    ...DEVICES,
    gate: {
      ...DEVICES.gate,
      maxLoadPerCore: 1,
      estimates: {
        ios: { memoryMb: 4608, load: 2 },
        android: { memoryMb: 6144, load: androidLoad },
      },
    },
  }
  const deps = createDeps({
    home,
    config: { devices },
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    stdin: { isTTY: false },
    journeyIds: () => ["cold-launch-home"],
    spawnDetached: (...args) => spawned.push(args),
    git: { head: async () => COMMIT, dirty: async () => [] },
    setup: { check: async () => readySetup() },
    devices: {
      list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
      runningForeign: () => [],
    },
    host: {
      sample: async () => samples[Math.min(reads++, samples.length - 1)],
      diskFree: () => ({ dir: home, freeBytes: 200 * GB }),
    },
    admin: {
      preflight: async () => ({ url: "u", reachable: true, detail: null }),
    },
  })
  return { deps, out, err, spawned }
}

const RUN_START = parseArgs([
  "run",
  "--yes",
  "--detach",
  "--expect-commit",
  COMMIT,
])

describe("the capacity check of plan and of the run's start", () => {
  it("refuses with the same numbers in both only when the devices push the load over the limit", async () => {
    const refused = stubDeps({ androidLoad: 3 })
    const message =
      "The Mac's load average is too high to run one simulator and one emulator at the same time: 12.5 with them, and the limit is 12.0."

    expect(await planCommand(parseArgs(["plan", "--json"]), refused.deps)).toBe(
      0,
    )
    const refusedPlan = JSON.parse(refused.out.at(-1))
    expect(refusedPlan.refusals).toEqual([{ code: "HOST_CAPACITY", message }])
    expect(refusedPlan.host).toMatchObject({
      load1: 7.5,
      startCheckLoad: 12.5,
      loadLimit: 12,
    })
    expect(await runCommand(RUN_START, refused.deps)).toBe(2)
    expect(refused.err.join("\n")).toContain(`- HOST_CAPACITY: ${message}`)
    expect(refused.spawned).toEqual([])

    const admitted = stubDeps({ androidLoad: 2 })
    expect(
      await planCommand(parseArgs(["plan", "--json"]), admitted.deps),
    ).toBe(0)
    const admittedPlan = JSON.parse(admitted.out.at(-1))
    expect(admittedPlan.refusals).toEqual([])
    expect(admittedPlan.host).toMatchObject({
      load1: 7.5,
      startCheckLoad: 11.5,
      loadLimit: 12,
    })
    expect(admittedPlan.text.split("\n")).toContain(
      "Memory and load: 40000 MB free, load 7.5 on 12 cores. With one simulator and one emulator, the load is 11.5, and the limit is 12.0. Lanes that can start now: ios, androidPhone.",
    )
    expect(await runCommand(RUN_START, admitted.deps)).toBe(0)
    expect(admitted.err).toEqual([])
    expect(admitted.spawned).toHaveLength(1)
  })
})

describe("a stale lock", () => {
  const CALM_MAC = { availableMb: 40000, load1: 1, cores: 12 }

  function writeDeadLock(home, mode) {
    const dead = {
      pid: childProcess.spawnSync("/usr/bin/true").pid,
      processStart: "Thu Oct 22 01:00:00 2026",
      mode,
      runId: `2026-10-22T01-00-00Z-${mode}`,
    }
    fs.writeFileSync(path.join(home, "lock.json"), JSON.stringify(dead))
    return dead
  }

  it.each([
    { mode: "run", cleanup: "recover" },
    { mode: "session", cleanup: "session down" },
  ])(
    "of a $mode refuses the run and names `$cleanup`",
    async ({ mode, cleanup }) => {
      const { deps, out, err, spawned } = stubDeps({ samples: [CALM_MAC] })
      const dead = writeDeadLock(deps.home, mode)

      expect(await planCommand(parseArgs(["plan", "--json"]), deps)).toBe(0)
      const plan = JSON.parse(out.at(-1))
      expect(plan.refusals).toEqual([
        {
          code: "STALE_RUN_LOCK",
          message: expect.stringContaining(
            `Run \`node apps/mobile/release-check/cli.mjs ${cleanup}\` first.`,
          ),
        },
      ])
      expect(plan.text.split("\n")).toContain(
        `Lock: stale (mode ${mode}, pid ${dead.pid}, run ${dead.runId}; pid_ended). A run refuses until \`${cleanup}\` removes it.`,
      )

      expect(await runCommand(RUN_START, deps)).toBe(2)
      expect(err.join("\n")).toContain("- STALE_RUN_LOCK: ")
      expect(spawned).toEqual([])
      expect(readJson(path.join(deps.home, "lock.json"))).toEqual(dead)
    },
  )

  it.each(["setup", "record-search"])(
    "of a %s does not refuse the run",
    async (mode) => {
      const { deps, out, spawned } = stubDeps({ samples: [CALM_MAC] })
      const dead = writeDeadLock(deps.home, mode)

      expect(await planCommand(parseArgs(["plan", "--json"]), deps)).toBe(0)
      const plan = JSON.parse(out.at(-1))
      expect(plan.refusals).toEqual([])
      expect(plan.text.split("\n")).toContain(
        `Lock: stale (mode ${mode}, pid ${dead.pid}, run ${dead.runId}; pid_ended). The next run takes it over.`,
      )
      expect(await runCommand(RUN_START, deps)).toBe(0)
      expect(spawned).toHaveLength(1)
    },
  )
})

describe("plan --json", () => {
  it("carries in `text` the exact text that plan prints for the same inputs", async () => {
    const { deps, out } = stubDeps()

    await planCommand(parseArgs(["plan"]), deps)
    await planCommand(parseArgs(["plan", "--json"]), deps)

    expect(out[0]).toMatch(/^Release check plan for commit /)
    expect(JSON.parse(out[1]).text).toBe(out[0])
  })

  it("builds its text and its refusals from one reading of the Mac", async () => {
    const calm = { availableMb: 40000, load1: 1, cores: 12 }
    const { deps, out } = stubDeps({ samples: [BUSY_MAC, calm] })

    await planCommand(parseArgs(["plan", "--json"]), deps)

    const plan = JSON.parse(out[0])
    expect(plan.refusals.map((item) => item.code)).toEqual(["HOST_CAPACITY"])
    expect(plan.text).toContain(`- HOST_CAPACITY: ${plan.refusals[0].message}`)
    expect(plan.text).toContain("load 7.5 on 12 cores")
  })
})
