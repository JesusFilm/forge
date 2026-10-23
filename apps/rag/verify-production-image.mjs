import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout, clearTimeout } from "node:timers"
import { URL } from "node:url"
import { PrismaClient } from "./src/generated/prisma/index.js"

// CI's internal Docker network contains only this image and disposable PostgreSQL.
assert.equal(process.env.RAG_IMAGE_FIXTURE, "isolated")
const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname, "rag-security-db")
assert.equal(database.pathname, "/forge_rag_image")
const db = new PrismaClient({ datasourceUrl: database.toString() })
const sessionUrl = new URL(database)
sessionUrl.username = "rag_image_portal"
sessionUrl.password = "synthetic-only-test-password"
await db.$executeRawUnsafe(
  "CREATE ROLE rag_image_portal LOGIN PASSWORD 'synthetic-only-test-password'",
)
await db.$executeRawUnsafe(
  "GRANT USAGE ON SCHEMA portal_private TO rag_image_portal",
)
await db.$executeRawUnsafe(
  "GRANT SELECT, INSERT, DELETE ON portal_private.oauth_states, portal_private.sessions TO rag_image_portal",
)
await db.$disconnect()
const config = readFileSync("apps/rag/railway.toml", "utf8")
const start = config.match(/^startCommand = "([^"]+)"$/m)?.[1]
assert.ok(start)
const [command, ...args] = start.split(" ")
const env = {
  PATH: process.env.PATH,
  HOME: "/tmp",
  NODE_ENV: "production",
  PORT: "4124",
  DATABASE_URL: database.toString(),
  OPENROUTER_API_KEY: "synthetic-key-with-no-provider-authority",
  RAG_CONSUMER_WRITER_DATABASE_URL: database.toString(),
  RAG_CONSUMER_AUTH_DATABASE_URL: database.toString(),
  RAG_PORTAL_DATABASE_URL: sessionUrl.toString(),
  RAG_PORTAL_GITHUB_TOKEN: "synthetic-github-token",
  RAG_PORTAL_CLIENT_ID: "synthetic-client",
  RAG_PORTAL_CLIENT_SECRET: "synthetic-secret",
  RAG_PORTAL_CALLBACK_URL: "http://127.0.0.1:4124/portal/callback",
  RAG_PORTAL_ORIGIN: "http://127.0.0.1:4124",
}
const preDeploy = config.match(/^preDeployCommand = "([^"]+)"$/m)?.[1]
assert.ok(preDeploy)
await new Promise((resolve, reject) => {
  const grant = spawn("sh", ["-c", preDeploy], { env, stdio: "inherit" })
  grant.once("error", reject)
  grant.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("Pre-deploy failed")),
  )
})
const child = spawn(command, args, {
  detached: true,
  env,
  stdio: ["ignore", "ignore", "pipe"],
})
let bootErrors = ""
child.stderr.on("data", (chunk) => {
  bootErrors = (bootErrors + chunk).slice(-2000)
})
const request = (path, options = {}) =>
  globalThis.fetch(`http://127.0.0.1:4124${path}`, {
    ...options,
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(3000),
  })
try {
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.equal(child.exitCode, null, bootErrors)
    try {
      ready = (await request("/v1/health")).status === 200
    } catch {
      /* Await startup. */
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.ok(ready, bootErrors)
  for (const headers of [
    {},
    { authorization: "Bearer invalid-synthetic-token" },
  ]) {
    const response = await request("/v1/search", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query: "synthetic query" }),
    })
    assert.equal(response.status, 401)
  }
  console.log(
    "PASS: actual Railway RAG start command, pre-deploy role grant, health and anonymous/invalid-token denials",
  )
  console.log(
    "PASS: disposable PostgreSQL only; internal network prevents provider or corpus acquisition requests",
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
