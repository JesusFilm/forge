import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

// CI runs this image with --network none and public synthetic inputs only.
assert.equal(process.env.CHAT_IMAGE_FIXTURE, "isolated")
const start = readFileSync("apps/chat/railway.toml", "utf8").match(
  /^startCommand = "([^"]+)"$/m,
)?.[1]
assert.equal(start, "sh /app/apps/chat/start-production.sh")
const [command, ...args] = start.split(" ")
const request = (path, options = {}) =>
  fetch(`http://127.0.0.1:4126${path}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  })
for (const invalidEgress of [false, true]) {
  const child = spawn(command, args, {
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: "/tmp",
      NODE_ENV: "production",
      PORT: "4126",
      NEXT_TELEMETRY_DISABLED: "1",
      SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
      ...(invalidEgress
        ? { SEEKER_MASTRA_BASE_URL: "https://unavailable.example.invalid" }
        : {}),
    },
    stdio: "ignore",
  })
  try {
    let health
    for (let attempt = 0; attempt < 90; attempt++) {
      assert.equal(child.exitCode, null)
      try {
        health = await request("/api/health")
      } catch {
        /* Await the listening process. */
      }
      if (health) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.ok(health, "Configured production server must listen")
    if (invalidEgress) {
      assert.equal(health.status, 500)
      assert.equal((await request("/")).status, 500)
      console.log(
        "PASS: production egress misconfiguration still fails readiness and page with HTTP500",
      )
      continue
    }
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true, service: "forge-chat" })
    const page = await request("/")
    assert.equal(page.status, 200)
    const html = await page.text()
    const script = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1]
    assert.ok(script, "Page must reference a built client script")
    assert.equal((await request(script.replaceAll("&amp;", "&"))).status, 200)
    const icon = await request("/brand/jfp-sign-32.png")
    assert.equal(icon.status, 200)
    assert.match(icon.headers.get("content-type"), /image\/png/)
    for (const cookie of [undefined, "forge_chat_session=invalid-signature"]) {
      const denied = await request("/api/history/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: "{}",
      })
      assert.equal(denied.status, 401)
    }
    const seeker = await request("/api/seeker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "synthetic image acceptance",
        conversationId: "audit-fixture",
      }),
    })
    assert.equal(seeker.status, 200)
    assert.match(await seeker.text(), /gate_denied/)
    console.log(
      "PASS: actual configured next start, default-off readiness, HTML/client asset/icon and anonymous access denials",
    )
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve))
      process.kill(-child.pid, "SIGTERM")
      const timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 5000)
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
console.log(
  "PASS: no network, provider sign-in, model invocation or persistent conversation writes",
)
