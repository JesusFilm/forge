import { test } from "vitest"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { verifyNativeStartup } from "./startup.mjs"

test("native entrypoint refuses execution outside container PID1", () => {
  const result = spawnSync(resolve("dist/entrypoint"), [], {
    env: { PORT: "3330", STUDIO_RENDER_BROKER_PUBLIC_KEY: "not-a-key" },
    timeout: 1000,
  })
  assert.equal(result.status, 78)
})

test("Node cannot admit itself from environment startup claims", async () => {
  await assert.rejects(verifyNativeStartup(), /startup attestation required/)
})
