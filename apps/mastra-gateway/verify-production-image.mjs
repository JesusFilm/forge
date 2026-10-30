import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout, clearTimeout } from "node:timers"

assert.equal(process.env.GATEWAY_IMAGE_FIXTURE, "isolated")
const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname, "gateway-security-db")
assert.equal(database.pathname, "/forge_gateway_image")
assert.equal(database.password, "synthetic-only-test-password")
const start = readFileSync("apps/mastra-gateway/railway.toml", "utf8").match(
  /^startCommand = "([^"]+)"$/m,
)?.[1]
assert.equal(start, "sh /app/apps/mastra-gateway/start-production.sh")
const adminKey = "synthetic-runtime-admin-reader-no-real-authority"
const internalKey = "synthetic-runtime-internal-service-no-real-authority"
const approvalKey = "synthetic-runtime-approval-no-real-authority"
const playbackKey = "synthetic-runtime-playback-no-real-authority"
const child = spawn("sh", ["/app/apps/mastra-gateway/start-production.sh"], {
  detached: true,
  env: {
    PATH: process.env.PATH,
    HOME: "/tmp",
    NODE_ENV: "production",
    PORT: "4126",
    NEXT_TELEMETRY_DISABLED: "1",
    SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
    DATABASE_URL: database.toString(),
    AUTH_ISSUER_URL: "https://auth.example.invalid",
    AUTH_MASTRA_STUDIO_CLIENT_ID: "synthetic-gateway-image",
    MASTRA_GATEWAY_BASE_URL: "https://gateway.example.invalid",
    MASTRA_GATEWAY_SESSION_SECRET:
      "synthetic-runtime-session-secret-with-no-production-authority",
    MASTRA_INTERNAL_BASE_URL: "http://127.0.0.1:9",
    MASTRA_INTERNAL_API_KEY: internalKey,
    MASTRA_DEVOTIONAL_APPROVAL_API_KEY: approvalKey,
    MASTRA_DEVOTIONAL_PLAYBACK_API_KEY: playbackKey,
    MASTRA_GATEWAY_ADMIN_API_KEYS: adminKey,
  },
  stdio: ["ignore", "ignore", "pipe"],
})
let bootErrors = ""
child.stderr.on("data", (chunk) => {
  bootErrors = (bootErrors + chunk).slice(-2000)
})
const request = (path, init = {}) =>
  fetch(`http://127.0.0.1:4126${path}`, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  })
const isLoginRedirect = (response) => {
  assert.ok([302, 303, 307].includes(response.status))
  assert.equal(
    new URL(response.headers.get("location"), "https://gateway.example.invalid")
      .pathname,
    "/api/auth/login",
  )
}
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(child.exitCode, null, bootErrors)
    try {
      ready = (await request("/api/health")).status === 200
    } catch {
      /* Await migrations and cold standalone startup. */
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, bootErrors)
  assert.deepEqual(await (await request("/api/health")).json(), {
    ok: true,
    service: "mastra-gateway",
  })
  const home = await request("/")
  assert.equal(home.status, 307)
  assert.equal(
    new URL(home.headers.get("location"), "http://localhost").pathname,
    "/studio",
  )
  for (const path of ["/studio", "/api/studio/agents", "/admin"]) {
    isLoginRedirect(await request(path))
    isLoginRedirect(
      await request(path, {
        headers: { cookie: "mastra-gateway-session=invalid-public-control" },
      }),
    )
  }
  const adminRead = (key) =>
    request("/api/admin/studio-access", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ emails: ["nonexistent@fixture.invalid"] }),
    })
  for (const key of [
    undefined,
    "wrong-key",
    internalKey,
    approvalKey,
    playbackKey,
  ]) {
    assert.equal((await adminRead(key)).status, 401)
  }
  const records = await adminRead(adminKey)
  assert.equal(records.status, 200)
  assert.deepEqual(await records.json(), { records: [] })
  const callback = await request(
    "/api/auth/callback?code=invalid&state=invalid",
  )
  assert.equal(callback.status, 307)
  const location = new URL(callback.headers.get("location"))
  assert.equal(location.pathname, "/access-requested")
  assert.equal(location.searchParams.get("reason"), "forbidden")
  const denied = await request("/access-requested?reason=forbidden")
  assert.equal(denied.status, 200)
  const html = await denied.text()
  assert.match(html, /The sign-in attempt could not be verified/)
  const script = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1]
  assert.ok(script)
  assert.equal((await request(script)).status, 200)
  console.log(
    "PASS: actual Railway migration/start command, cold standalone readiness, denied page and built client asset",
  )
  console.log(
    "PASS: anonymous/invalid-cookie Studio and admin gates; invalid OAuth state denied without issuer access",
  )
  console.log(
    "PASS: disposable PostgreSQL reader uses runtime-only admin bearer; wrong/internal/approval/playback bearers denied",
  )
  console.log(
    "PASS: internal network only; no real identity, access mutation, upstream model or provider action",
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
