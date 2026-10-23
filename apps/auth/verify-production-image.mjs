import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout, clearTimeout } from "node:timers"
import { URL } from "node:url"

// Only CI's internal network and disposable PostgreSQL may use this fixture.
assert.equal(process.env.AUTH_IMAGE_FIXTURE, "isolated")
const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname, "auth-security-db")
assert.equal(database.pathname, "/forge_auth_image")
assert.equal(database.password, "synthetic-only-test-password")
const config = readFileSync("apps/auth/railway.toml", "utf8")
const start = config.match(/^startCommand = "([^"]+)"$/m)?.[1]
assert.ok(start)
const [command, ...args] = start.split(" ")
assert.equal(command, "node")
const child = spawn(command, args, {
  env: {
    PATH: process.env.PATH,
    HOME: "/tmp",
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
    PORT: "4125",
    NEXT_TELEMETRY_DISABLED: "1",
    SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
    DATABASE_URL: database.toString(),
    BETTER_AUTH_SECRET:
      "synthetic-runtime-auth-secret-with-no-production-authority",
    AUTH_BASE_URL: "https://auth.example.invalid",
  },
  stdio: ["ignore", "ignore", "pipe"],
})
let bootErrors = ""
child.stderr.on("data", (chunk) => {
  bootErrors = (bootErrors + chunk).slice(-2000)
})
const request = (path) =>
  globalThis.fetch(`http://127.0.0.1:4125${path}`, {
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(10000),
  })
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
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
  const discovery = await request("/.well-known/openid-configuration")
  assert.equal(discovery.status, 200)
  const metadata = await discovery.json()
  assert.equal(metadata.issuer, "https://auth.example.invalid/api/auth")
  assert.equal(metadata.jwks_uri, "https://auth.example.invalid/api/auth/jwks")
  // Render the supported device continuation without issuing a device grant.
  const login = await request("/login?user_code=000-000-0000")
  assert.equal(login.status, 200)
  const html = await login.text()
  const script = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1]
  assert.ok(script, "Login HTML must reference a built client script")
  assert.equal((await request(script)).status, 200)
  const logo = await request("/images/jesus-film-logo-brandpad-cropped.png")
  assert.equal(logo.status, 200)
  assert.match(logo.headers.get("content-type"), /image\/png/)
  const session = await request("/api/auth/get-session")
  assert.equal(session.status, 200)
  assert.equal(await session.json(), null)
  assert.equal(session.headers.get("x-frame-options"), "DENY")
  assert.match(
    session.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  )
  assert.equal(session.headers.get("x-content-type-options"), "nosniff")
  console.log(
    "PASS: actual Railway standalone command, Auth cold startup, readiness, configured discovery, anonymous session and security headers",
  )
  console.log(
    "PASS: disposable PostgreSQL and unavailable public issuer; no provider sign-in, account/session issuance or external network",
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
}
