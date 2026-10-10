import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { verifyExecutionBudget } from "../src/budget.mjs"
test("admission rejects worker-sized, unlimited and missing aggregate limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio460-budget-"))
  try {
    await assert.rejects(verifyExecutionBudget(dir))
    for (const [name, value] of Object.entries({
      "memory.max": "24000000000",
      "memory.swap.max": "0",
      "pids.max": "1000",
      "cpu.max": "2400000 100000",
    }))
      await writeFile(join(dir, name), value)
    await assert.rejects(verifyExecutionBudget(dir), /containment/)
    for (const [name, value] of Object.entries({
      "memory.max": "2147483648",
      "pids.max": "128",
      "cpu.max": "200000 100000",
    }))
      await writeFile(join(dir, name), value)
    assert.deepEqual(await verifyExecutionBudget(dir), {
      memoryBytes: 2147483648,
      swapBytes: 0,
      tasks: 128,
      cpuQuota: 200000,
      cpuPeriod: 100000,
    })
    await writeFile(join(dir, "pids.max"), "max")
    await assert.rejects(verifyExecutionBudget(dir), /containment/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
