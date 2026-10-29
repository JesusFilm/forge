import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout, clearTimeout } from "node:timers"

assert.equal(process.env.MANAGER_IMAGE_FIXTURE, "isolated")
const command = readFileSync("apps/manager/railway.toml", "utf8").match(
  /^startCommand = "([^"]+)"$/m,
)?.[1]
assert.equal(
  command,
  "node /app/apps/manager/.next/standalone/apps/manager/server.js",
)
const apiKey = "synthetic-runtime-manager-reader-no-real-authority"
const child = spawn(
  "node",
  ["/app/apps/manager/.next/standalone/apps/manager/server.js"],
  {
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: "/tmp",
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: "4127",
      NEXT_TELEMETRY_DISABLED: "1",
      SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
      MUX_TOKEN_ID: "synthetic-runtime-mux-id",
      MUX_TOKEN_SECRET: "synthetic-runtime-mux-secret",
      OPENROUTER_API_KEY: "synthetic-runtime-openrouter-key",
      MANAGER_DATA_MODE: "admin",
      MANAGER_API_KEY: apiKey,
      ADMIN_TRIGGER_API_KEYS: "synthetic-runtime-trigger-key",
      MANAGER_BASE_URL: "https://manager.example.invalid",
      MANAGER_SESSION_SECRET:
        "synthetic-runtime-manager-session-with-no-production-authority",
      AUTH_ISSUER_URL: "https://auth.example.invalid",
      AUTH_MANAGER_CLIENT_ID: "synthetic-image-manager",
      ADMIN_GRAPHQL_URL: "http://127.0.0.1:9/api/graphql",
      ADMIN_MANAGER_API_KEY: "synthetic-runtime-admin-backend-key",
      STUDIO_RENDER_POOL_ENABLED: "false",
      STUDIO_MUX_INGEST_ENABLED: "false",
      AWS_EC2_METADATA_DISABLED: "true",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
)
let bootErrors = ""
child.stderr.on("data", (chunk) => {
  bootErrors = (bootErrors + chunk).slice(-2000)
})
const request = (path, init = {}) =>
  fetch(`http://127.0.0.1:4127${path}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  })
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(child.exitCode, null, bootErrors)
    try {
      ready = (await request("/api/health")).status === 200
    } catch {
      /* Await startup. */
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, bootErrors)
  assert.deepEqual(await (await request("/api/health")).json(), {
    status: "ok",
  })
  const login = await request("/login?error=forbidden")
  assert.equal(login.status, 200)
  const html = await login.text()
  assert.match(html, /Manager access unavailable/)
  const script = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1]
  assert.ok(script)
  assert.equal((await request(script)).status, 200)
  const logo = await request("/jesusfilm-sign.svg")
  assert.equal(logo.status, 200)
  assert.match(logo.headers.get("content-type"), /image\/svg/)
  for (const [path, deniedStatus] of [
    ["/api/videos", 401],
    ["/api/languages", 401],
    ["/api/backfill/status", 401],
    ["/api/admin/engine-flag", 403],
  ]) {
    assert.equal((await request(path)).status, deniedStatus)
    assert.equal(
      (
        await request(path, {
          headers: {
            cookie: "manager-session=invalid; strapi-jwt=legacy-invalid",
          },
        })
      ).status,
      deniedStatus,
    )
    assert.equal(
      (await request(path, { headers: { authorization: "Bearer wrong-key" } }))
        .status,
      deniedStatus,
    )
  }
  const retired = await request("/api/backfill/status", {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  assert.equal(retired.status, 410)
  assert.equal((await retired.json()).retired, true)
  const engine = await request("/api/admin/engine-flag", {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  assert.equal(engine.status, 200)
  assert.deepEqual(await engine.json(), { engine: "workflow", override: null })
  const dashboard = await request("/dashboard/coverage")
  assert.ok([302, 303, 307].includes(dashboard.status))
  assert.equal(
    new URL(
      dashboard.headers.get("location"),
      "https://manager.example.invalid",
    ).pathname,
    "/login",
  )
  const callback = await request(
    "/api/auth/callback?code=invalid&state=invalid",
  )
  assert.equal(callback.status, 307)
  const callbackLocation = new URL(callback.headers.get("location"))
  assert.equal(callbackLocation.pathname, "/login")
  assert.equal(callbackLocation.searchParams.get("error"), "invalid_state")
  const unsigned = await request("/api/admin-trigger/transcript", {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  })
  assert.ok([401, 403].includes(unsigned.status))
  console.log(
    "PASS: actual configured standalone command, production cold health, denied login HTML and shipped JS/logo",
  )
  console.log(
    "PASS: anonymous/invalid-cookie/wrong-key API and dashboard denials; runtime-only API key reads retired endpoint; invalid OAuth state denied",
  )
  console.log(
    "PASS: compiled feature-flag resolver loads with no SDK key and returns the default workflow engine without an override",
  )
  console.log(
    "PASS: unauthorized workflow trigger denied; no network, real identity, content, model/provider, render, publication or push action",
  )
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve))
    process.kill(-child.pid, "SIGTERM")
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        /* Already exited. */
      }
    }, 5000)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }
}
