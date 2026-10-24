import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { readFileSync, appendFileSync } from "node:fs"
import { X509Certificate } from "node:crypto"

assert.equal(process.env.ADMIN_IMAGE_FIXTURE, "isolated")
const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname, "admin-security-db")
assert.equal(database.pathname, "/forge_admin_image")
assert.equal(database.password, "synthetic-only-test-password")
assert.equal(process.env.REDIS_HOST, "admin-security-redis")
for (const name of ["pg_dump", "pg_restore", "psql"]) {
  const version = spawnSync(name, ["--version"], { encoding: "utf8" })
  assert.equal(version.status, 0)
  assert.match(version.stdout, /18\.6/)
}
// First reject the disposable server without trusting its fixture certificate.
const untrusted = spawnSync(
  "psql",
  [database.toString(), "-w", "-Atc", "SELECT 1"],
  {
    env: { ...process.env, PGSSLMODE: "verify-full", PGSSLROOTCERT: "system" },
    encoding: "utf8",
    timeout: 15000,
  },
)
assert.equal(untrusted.status, 2)
assert.match(
  untrusted.stderr,
  /certificate verify failed|self-signed certificate/i,
)
// Trust only this disposable server's public certificate in the CI container.
const fixtureCA = readFileSync("/tmp/admin-image-pg.crt")
const certificate = new X509Certificate(fixtureCA)
assert.equal(certificate.subject, "CN=admin-security-db")
assert.equal(certificate.issuer, certificate.subject)
appendFileSync("/etc/ssl/certs/ca-certificates.crt", fixtureCA)
process.env.PGSSLMODE = "verify-full"
process.env.PGSSLROOTCERT = "system"
const tls = spawnSync(
  "psql",
  [
    database.toString(),
    "-Atc",
    "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
  ],
  { encoding: "utf8", timeout: 15000 },
)
assert.equal(tls.status, 0)
assert.equal(tls.stdout.trim(), "t")
// Prove the shipped native backup client against disposable data only.
const dump = spawnSync(
  "pg_dump",
  [
    database.toString(),
    "--schema-only",
    "--format=custom",
    "--file=/tmp/admin-image-schema.dump",
  ],
  { stdio: "ignore", timeout: 30000 },
)
assert.equal(dump.status, 0)
assert.equal(
  spawnSync("pg_restore", ["--list", "/tmp/admin-image-schema.dump"], {
    stdio: "ignore",
    timeout: 10000,
  }).status,
  0,
)
const restoredDatabase = new URL(database)
restoredDatabase.pathname = "/forge_admin_image_restore"
assert.equal(
  spawnSync(
    "createdb",
    ["--maintenance-db=" + database.toString(), "forge_admin_image_restore"],
    { stdio: "ignore", timeout: 15000 },
  ).status,
  0,
)
assert.equal(
  spawnSync(
    "pg_restore",
    [
      "--exit-on-error",
      "--no-owner",
      "--dbname=" + restoredDatabase.toString(),
      "/tmp/admin-image-schema.dump",
    ],
    { stdio: "ignore", timeout: 30000 },
  ).status,
  0,
)
for (const [file, role] of [
  ["railway.toml", "web"],
  ["railway.worker.toml", "worker"],
]) {
  const config = readFileSync(`apps/admin/${file}`, "utf8")
  const start = config.match(/^startCommand = "([^"]+)"$/m)?.[1]
  assert.equal(start, `sh /app/apps/admin/start-production.sh ${role}`)
  const [command, ...args] = start.split(" ")
  const child = spawn(command, args, {
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: "/tmp",
      NODE_ENV: "production",
      PORT: "4127",
      NEXT_TELEMETRY_DISABLED: "1",
      SSL_CERT_DIR: "/usr/local/share/security-ca/certs",
      DATABASE_URL: database.toString(),
      ADMIN_SESSION_SECRET: "synthetic-runtime-admin-secret-with-no-authority",
      AUTH_ISSUER_URL: "https://auth.example.invalid/api/auth",
      AUTH_ADMIN_CLIENT_ID: "synthetic-admin-image",
      REDIS_HOST: "admin-security-redis",
      REDIS_PORT: "6379",
      ...(role === "worker"
        ? {
            TYPESENSE_API_KEY: "synthetic-shared-reader-operator-key",
            TYPESENSE_SEARCH_API_KEY: "synthetic-shared-reader-operator-key",
            TYPESENSE_OPERATOR_API_KEY: "synthetic-shared-reader-operator-key",
          }
        : {}),
      // A disposable worker may queue its existing schedulers in this database.
      WORKFLOW_RUNNER_ENABLED: role === "worker" ? "true" : "false",
      WORKFLOW_TARGET_WORLD:
        role === "worker" ? "@workflow/world-postgres" : "local",
      WORKFLOW_POSTGRES_URL: database.toString(),
      WORKFLOW_HMAC_SECRET: "synthetic-image-workflow-secret-with-no-authority",
      WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED: "false",
      WATCH_CATALOG_PUBLICATION_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  let bootErrors = ""
  child.stderr.on("data", (chunk) => {
    bootErrors = (bootErrors + chunk).slice(-2500)
  })
  const request = (path, options = {}) =>
    fetch(`http://127.0.0.1:4127${path}`, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    })
  try {
    let ready = false
    for (let attempt = 0; attempt < 150; attempt++) {
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
    const dashboard = await request("/dashboard")
    assert.ok(
      [302, 303, 307].includes(dashboard.status),
      "Anonymous dashboard must redirect to sign-in",
    )
    const graphql = await request("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query ImageReadiness { __typename }" }),
    })
    assert.equal(graphql.status, 200)
    assert.equal((await graphql.json()).data?.__typename, "Query")
    const denied = await request("/api/workflows/not-authorized", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    assert.ok(
      [401, 403].includes(denied.status),
      "Workflow API must deny anonymous caller",
    )
    console.log(
      `PASS: actual configured ${role} command, Redis/GraphQL readiness, anonymous dashboard/workflow denials and public schema read`,
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
  "PASS: shipped PostgreSQL18 clients verify disposable server TLS and schema dump/list/restore; isolated database/Redis only, no real providers, content, publication or push",
)
