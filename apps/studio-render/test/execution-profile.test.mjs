import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { executionProfile } from "../src/vm/execution-profile.mjs"
import { STUDIO_RENDER_PROFILE } from "../../../packages/studio-contracts/src/render.ts"
import { VmJobApi } from "../src/vm/job-api.mjs"

test("host, native watchdog and release share the immutable execution bounds", async () => {
  for (const [key, value] of Object.entries(executionProfile))
    assert.equal(value, STUDIO_RENDER_PROFILE[key])
  const watchdog = await readFile(
    new URL("../native/vm-watchdog.c", import.meta.url),
    "utf8",
  )
  assert.ok(watchdog.includes(`deadline-now_ms()>${executionProfile.jobMs}`))
  const release = await readFile(
    new URL("../ops/release/release.py", import.meta.url),
    "utf8",
  )
  assert.ok(release.includes(`PROFILE = '${executionProfile.id}'`))
})

test("input uses the full preparation timeout and composes cancellation", async (t) => {
  const timeouts = []
  t.mock.method(AbortSignal, "timeout", (ms) => {
    timeouts.push(ms)
    return new AbortController().signal
  })
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    signal.throwIfAborted()
    return new Response('{"prepared":true}', {
      headers: { "content-type": "application/json" },
    })
  })
  const api = new VmJobApi({
    endpoint: "https://fixture.example/owned",
    token: "x".repeat(40),
    poolId: "pool",
    workerId: "worker",
  })
  const capability = "a." + "b".repeat(43)
  assert.deepEqual(
    await api.json("input", {}, new AbortController().signal, capability),
    { prepared: true },
  )
  assert.deepEqual(timeouts, [STUDIO_RENDER_PROFILE.preparationMs])
  const parent = new AbortController()
  parent.abort()
  await assert.rejects(
    api.json("input", {}, parent.signal, capability),
    /unconfirmed/,
  )
})
