import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout, clearTimeout } from "node:timers"

// Run only with Docker --network=none; SQLite and these synthetic keys are disposable.
assert.equal(process.env.AGENTIC_IMAGE_FIXTURE, "isolated")
const directory = mkdtempSync(join(tmpdir(), "agentic-image-"))
const operator = "ci-runtime-operator-token"
const service = "ci-runtime-service-token"
const origin = "http://127.0.0.1:4123"
const child = spawn(process.execPath, [".mastra/output/index.mjs"], {
  env: {
    PATH: process.env.PATH,
    HOME: directory,
    NODE_ENV: "production",
    AGENTIC_PORT: "4123",
    AGENTIC_SERVICE_API_KEY: service,
    AGENTIC_OPERATOR_API_KEY: operator,
    AGENTIC_STORAGE_URL: `file:${directory}/runtime.db`,
    AGENTIC_MODEL: "openai/gpt-5-mini",
    MANAGER_BASE_URL: "http://127.0.0.1:9",
    MANAGER_AGENTIC_API_KEY: "ci-runtime-manager-token",
    OPENAI_API_KEY: "synthetic-key-with-no-provider-authority",
  },
  stdio: ["ignore", "ignore", "pipe"],
})
let bootErrors = ""
child.stderr.on("data", (chunk) => {
  bootErrors = (bootErrors + chunk).slice(-2000)
})
const request = async (path, token) => {
  const response = await globalThis.fetch(origin + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: globalThis.AbortSignal.timeout(3000),
    redirect: "manual",
  })
  return { status: response.status, text: await response.text() }
}
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.equal(
      child.exitCode,
      null,
      `Production entrypoint exited: ${bootErrors}`,
    )
    try {
      ready = (await request("/health")).status === 200
    } catch {
      // Wait for the actual bundled entrypoint and local SQLite initialization.
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(
    ready,
    `Production entrypoint did not become healthy: ${bootErrors}`,
  )
  assert.equal((await request("/api/agents")).status, 401)
  assert.equal((await request("/api/agents", service)).status, 401)
  assert.equal(
    (await request("/api/agents", "wrong-operator-token")).status,
    401,
  )
  assert.equal(
    (await request("/api/agents", "ci-build-operator-token")).status,
    401,
  )
  const agents = await request("/api/agents", operator)
  assert.equal(agents.status, 200)
  assert.match(agents.text, /Manager Automation Agent/)
  for (const path of ["/api/tools", "/api/workflows"]) {
    const response = await request(path, operator)
    assert.equal(response.status, 200)
    assert.equal(typeof JSON.parse(response.text), "object")
  }
  console.log(
    "PASS: actual production entrypoint, health, operator agent/tool/workflow reads and anonymous/service/wrong/build-key denials",
  )
  console.log(
    "PASS: disposable SQLite only; no model, Manager, workflow execution or external network",
  )
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }
  rmSync(directory, { recursive: true, force: true })
}
