import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import {
  currentCgroupDirectory,
  verifyExecutionBudget,
  StudioContainmentError,
} from "../src/budget.mjs"

// Run inside the owned OCI fixture with either its own read-only cgroup leaf
// or an unrelated bounded leaf mounted at /sys/fs/cgroup. No writable cgroup
// access or host PID assumption belongs in the admission check.
const scenario = process.env.STUDIO_CGROUP_MEMBERSHIP_CASE

test(
  "startup admission rejects an unrelated bounded cgroup mount",
  { skip: scenario !== "unrelated" },
  async () => {
    await assert.rejects(
      async () => verifyExecutionBudget(await currentCgroupDirectory()),
      StudioContainmentError,
    )
  },
)

test(
  "startup admission accepts its own bounded read-only leaf in a PID namespace",
  { skip: scenario !== "own" },
  async () => {
    assert.equal(process.pid, 1)
    const directory = await currentCgroupDirectory()
    const budget = await verifyExecutionBudget(directory)
    await assert.rejects(
      writeFile(`${directory}/cgroup.procs`, String(process.pid)),
      { code: "EROFS" },
    )
    assert.equal(budget.tasks, 128)
    assert.equal(budget.memoryBytes, 2147483648)
    assert.equal(budget.swapBytes, 0)
    assert.equal(budget.cpuQuota / budget.cpuPeriod, 2)
    assert.match(await readFile("/proc/self/cgroup", "utf8"), /^0::\/\n$/)
  },
)

test(
  "startup admission rejects membership overlaid onto another cgroup",
  { skip: scenario !== "overlaid" },
  async () => {
    await assert.rejects(
      async () => verifyExecutionBudget(await currentCgroupDirectory()),
      StudioContainmentError,
    )
  },
)
