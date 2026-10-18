import { test } from "node:test"
import assert from "node:assert/strict"
import { inspectGate, retirementClear } from "../ops/on-demand/guest.mjs"
const port = (overrides = {}) => ({
  owner: async () => "controller",
  status: async () => ({ state: "drained", active: "inactive" }),
  retired: async () => true,
  ...overrides,
})
test("manual drains cannot be adopted for automatic shutdown", async () => {
  assert.equal(
    await inspectGate(
      port({
        owner: async () => "manual",
        status: () => {
          throw Error("must not inspect")
        },
      }),
    ),
    "blocked",
  )
})
test("stale idle/drained files and live services cannot authorize poweroff", async () => {
  for (const state of ["idle", "assigned", "settled"])
    assert.equal(
      await inspectGate(
        port({ status: async () => ({ state, active: "inactive" }) }),
      ),
      "draining",
    )
  assert.equal(
    await inspectGate(
      port({ status: async () => ({ state: "drained", active: "active" }) }),
    ),
    "draining",
  )
})
test("only inactive drained worker with independently retired runtime is safe", async () => {
  assert.equal(await inspectGate(port()), "safe")
  assert.equal(
    await inspectGate(port({ retired: async () => false })),
    "blocked",
  )
  await assert.rejects(
    inspectGate(
      port({
        retired: async () => {
          throw Error("Malformed journal")
        },
      }),
    ),
  )
})
test("unfinished journals, stopped containers and remaining scopes all block retirement", () => {
  const done = [
    { assignment: {}, complete: true },
    { assignment: null, complete: false },
  ]
  assert.ok(retirementClear(done, "", []))
  assert.equal(
    retirementClear([{ assignment: {}, complete: false }], "", []),
    false,
  )
  assert.equal(retirementClear(done, "container-id\n", []), false)
  assert.equal(
    retirementClear(done, "", ["forge-studio-j" + "a".repeat(32) + ".slice"]),
    false,
  )
})
