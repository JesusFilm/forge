import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout, clearTimeout } from "node:timers"
import { URL } from "node:url"

assert.equal(process.env.AGENTIC_STUDIO_IMAGE_FIXTURE, "isolated")
const start = readFileSync("railway.studio.toml", "utf8").match(
  /^startCommand = "([^"]+)"$/m,
)?.[1]
assert.equal(start, "sh /app/apps/agentic/start-studio-production.sh")
const operator = "synthetic-runtime-studio-operator-never-served"
const child = spawn("sh", ["/app/apps/agentic/start-studio-production.sh"], {
  detached: true,
  env: {
    PATH: process.env.PATH,
    HOME: "/tmp",
    NODE_ENV: "production",
    PORT: "4128",
    SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
    MASTRA_STUDIO_BASE_PATH: "/api/agentic-studio",
    AGENTIC_OPERATOR_API_KEY: operator,
  },
  stdio: ["ignore", "ignore", "pipe"],
})
let errors = ""
child.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-1500)
})
const request = (path, headers = {}) =>
  globalThis.fetch(`http://127.0.0.1:4128${path}`, {
    headers,
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(10000),
  })
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    assert.equal(child.exitCode, null, errors)
    try {
      ready = (await request("/api/agentic-studio/")).status === 200
    } catch {
      /* Await CLI. */
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, errors)
  const response = await request("/api/agentic-studio/")
  const html = await response.text()
  assert.match(html, /forgeagentic-stage\.up\.railway\.app/)
  assert.match(html, /\/api\/agentic-studio/)
  assert.ok(!html.includes(operator))
  assert.ok(
    !/%%MASTRA_(STUDIO_BASE_PATH|SERVER_HOST|SERVER_PORT|SERVER_PROTOCOL|API_PREFIX|TELEMETRY_DISABLED)%%/.test(
      html,
    ),
  )
  const script = html.match(/src="([^" ]+\.js)"/)?.[1]
  assert.ok(script)
  const path = new URL(script, "http://127.0.0.1:4128/api/agentic-studio/")
    .pathname
  const asset = await request(path)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get("content-type"), /javascript/)
  assert.ok(!(await asset.text()).includes(operator))
  const svg = await request("/api/agentic-studio/mastra.svg")
  assert.equal(svg.status, 200)
  assert.match(svg.headers.get("content-type"), /image\/svg/)
  const compressed = await request("/api/agentic-studio/", {
    "accept-encoding": "gzip",
  })
  assert.equal(compressed.status, 200)
  assert.equal(compressed.headers.get("content-encoding"), "gzip")
  assert.equal(await compressed.text(), html)
  console.log(
    "PASS: actual private Studio command and runtime port, base path/backend metadata, JS/SVG and gzip static serving",
  )
  console.log(
    "PASS: synthetic operator absent from served assets; isolated network, no real Manager session or backend/provider invocation",
  )
  console.log(
    "LIMIT: static SPA responses do not prove authenticated backend or Manager browser access; private production binding still requires owner approval",
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
