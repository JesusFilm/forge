import assert from "node:assert/strict"
import { URL } from "node:url"
import { setTimeout, clearTimeout } from "node:timers"
import { spawn, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

assert.equal(process.env.MASTRA_IMAGE_FIXTURE, "isolated")
const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname, "mastra-security-db")
assert.equal(database.pathname, "/forge_mastra_image")
const service = "synthetic-runtime-service-key"
const lane = "synthetic-runtime-lane-key"
const approval = "synthetic-runtime-approval-key"
const playback = "synthetic-runtime-playback-key"
const config = readFileSync("/app/apps/mastra/railway.toml", "utf8")
const start = config.match(/^startCommand = "([^"]+)"$/m)?.[1]
assert.equal(start, "node /app/apps/mastra/.mastra/output/index.mjs")
const migration = spawnSync(
  "pnpm",
  ["--filter", "@forge/mastra", "migrate:database"],
  {
    cwd: "/app",
    env: { ...process.env, NODE_ENV: "development" },
    encoding: "utf8",
    timeout: 60000,
  },
)
assert.equal(migration.status, 0, migration.stderr.slice(-2000))
assert.match(migration.stdout, /Mastra database migrations applied=/)
const request = (path, token, body) =>
  globalThis.fetch(`http://127.0.0.1:4130${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(10000),
  })
for (const enabled of [false, true]) {
  const [command, ...args] = start.split(" ")
  const requireAttestation = process.env.MASTRA_IMAGE_ATTESTATION === "required"
  const child = spawn(command, args, {
    cwd: "/app/apps/mastra",
    detached: true,
    env: {
      PATH: process.env.PATH,
      ...(requireAttestation
        ? {
            NODE_OPTIONS: "--import=/app/apps/mastra/startup-security.mjs",
            RAILWAY_DEPLOYMENT_ID: "isolated-production-image-ci",
          }
        : {}),
      HOME: "/tmp",
      NODE_ENV: "production",
      PORT: "4130",
      DATABASE_URL: database.toString(),
      MASTRA_STORAGE_BACKEND: "postgres",
      MASTRA_STORAGE_DIR: "/tmp/mastra-image-storage",
      MASTRA_STUDIO_PATH: "/app/apps/mastra/.mastra/output/studio",
      MASTRA_TELEMETRY_DISABLED: "1",
      MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE: "legacy",
      MASTRA_SERVICE_API_KEYS: service,
      AI_CHAT_SERVICE_API_KEYS: lane,
      DEVOTIONAL_APPROVAL_API_KEYS: approval,
      DEVOTIONAL_PLAYBACK_API_KEYS: playback,
      DEVOTIONAL_NEW_RUNS_ENABLED: "false",
      OPENAI_API_KEY: "synthetic-runtime-model-key-with-no-authority",
      FIRECRAWL_API_KEY: "synthetic-runtime-firecrawl-key-with-no-authority",
      ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY:
        "synthetic-runtime-experience-ingest",
      ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY:
        "synthetic-runtime-transcript-ingest",
      ADMIN_EXPERIENCE_INGEST_URL: "https://admin.example.invalid/experience",
      ADMIN_TRANSCRIPT_INGEST_URL: "https://admin.example.invalid/transcript",
      ...(enabled ? { SEEKER_ROUTE_ENABLED: "true" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-100000)
  })
  let errors = ""
  child.stderr.on("data", (chunk) => {
    errors = (errors + chunk).slice(-2500)
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 180; attempt++) {
      assert.equal(child.exitCode, null, errors)
      try {
        ready = (await request("/health")).status === 200
      } catch {
        /* Await real production boot. */
      }
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.ok(ready, errors)
    if (requireAttestation) {
      const proof = output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .find((row) => row?.event === "mastra_runtime_security")
      assert.equal(proof?.status, "pass", errors)
      assert.equal(proof.pid, child.pid)
      assert.equal(proof.RAILWAY_DEPLOYMENT_ID, "isolated-production-image-ci")
      assert.equal(proof.controls.length, 12)
      assert.ok(proof.controls.every((control) => control.passed))
      console.log(
        "PASS: actual healthy Mastra serving PID matches startup runtime attestation",
      )
    }
    for (const path of ["/api/agents", "/api/workflows"]) {
      const metadata = await request(path)
      assert.equal(metadata.status, 200)
      assert.match(metadata.headers.get("content-type"), /json/)
      assert.ok(Object.keys(await metadata.json()).length > 0)
    }
    const studio = await request("/studio")
    assert.equal(studio.status, 200)
    const html = await studio.text()
    assert.match(html, /Mastra Studio/)
    const script = html.match(/src="\.\/([^"]+\.js)"/)?.[1]
    assert.ok(script, "Studio JS must be included")
    assert.equal((await request(`/studio/${script}`)).status, 200)
    assert.equal((await request("/studio/mastra.svg")).status, 200)
    for (const key of [
      undefined,
      "wrong-key",
      lane,
      approval,
      playback,
      "synthetic-build-key",
    ]) {
      assert.equal(
        (await request("/forge-smoke", key, { input: "image-fixture" })).status,
        401,
      )
    }
    const smoke = await request("/forge-smoke", service, {
      input: "image-fixture",
    })
    assert.equal(smoke.status, 200)
    assert.deepEqual(await smoke.json(), {
      ok: true,
      agentId: "smokeAgent",
      echo: "image-fixture",
    })
    const native = await request(
      "/api/workflows/video-first-devotional/start",
      undefined,
      {},
    )
    assert.equal(native.status, 403)
    assert.equal(
      (await native.json()).error,
      "devotional_lifecycle_route_required",
    )
    const deniedStart = await request(
      "/forge-video-first-devotional",
      service,
      {},
    )
    assert.equal(deniedStart.status, 503)
    for (const key of [undefined, "wrong-key", service, approval, playback]) {
      assert.equal(
        (await request("/forge-ai-chat-history-list", key, {})).status,
        enabled ? 401 : 404,
      )
    }
    if (enabled) {
      // Authenticated empty-database read only; no chat/model generation.
      const history = await request("/forge-ai-chat-history-list", lane, {
        resourceId: "user:synthetic-image-fixture",
      })
      assert.equal(history.status, 200)
      assert.deepEqual((await history.json()).threads, [])
    } else {
      assert.equal((await request("/forge-seeker", lane, {})).status, 404)
    }
    console.log(
      `PASS: actual production PostgreSQL/DuckDB startup, health, native metadata and Studio/assets; seeker lane ${enabled ? "enabled read" : "default off"}`,
    )
    console.log(
      "PASS: runtime service deterministic smoke, cross-lane denials, native devotional mutation refusal and new-run kill switch",
    )
  } finally {
    const stopped = new Promise((resolve) => child.once("exit", resolve))
    process.kill(-child.pid, "SIGTERM")
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        /* Already stopped. */
      }
    }, 15000)
    await stopped
    clearTimeout(timer)
  }
}
console.log(
  "LIMIT: native framework metadata remains protected by existing private-network/gateway boundary; no model, real identity, workflow, provider or production data action",
)
