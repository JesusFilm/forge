/** Guarded transport/expiry probe; does not impersonate authenticated browser review. */
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { resolve, join } from "node:path"
const { fetch, AbortSignal, URL, Buffer } = globalThis
const [output, projectId, attemptId] = process.argv.slice(2)
const config = JSON.parse(
  await readFile(join(output, "environment.json"), "utf8"),
)
assert.equal(
  config.DATABASE_URL,
  "postgresql://tataihono@127.0.0.1:55460/forge_studio_548_qualification",
)
assert.equal(config.STUDIO_MCP_AUDIENCE, "http://127.0.0.1:55483/mcp")
const token = (await readFile(join(output, "token"), "utf8")).trim()
async function read() {
  const response = await fetch(config.STUDIO_MCP_AUDIENCE, {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: {
        name: "shorts.renderRead",
        arguments: { projectId, attemptId },
      },
    }),
    signal: AbortSignal.timeout(30000),
  })
  const body = await response.json()
  assert.ok(response.ok && !body.error && !body.result?.isError)
  const result = body.result.structuredContent.result
  const url = new URL(result.access.url)
  assert.equal(url.origin, "http://127.0.0.1:55482")
  assert.match(url.pathname, /^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/)
  return result
}
const first = await read()
await new Promise((done, fail) => {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      "tsconfig.json",
      "scripts/studio-agent-qualification-check.ts",
      output,
      "expire-capability",
      projectId,
    ],
    { cwd: resolve("apps/admin"), stdio: ["pipe", "ignore", "pipe"] },
  )
  let error = ""
  child.stderr.on("data", (chunk) => {
    error += chunk.toString().slice(0, 4096 - error.length)
  })
  child.on("error", fail)
  child.on("exit", (code) => (code === 0 ? done() : fail(new Error(error))))
  child.stdin.end(first.access.url)
})
const expired = await fetch(first.access.url, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
})
assert.equal(expired.status, 403)
await expired.body?.cancel()
// This deliberately expired fixture no longer grants access. Retain no live bearer.
await writeFile(
  join(output, "client-workspace", "expired-preview.json"),
  JSON.stringify({
    fixtureOnly: true,
    projectId,
    attemptId,
    url: first.access.url,
    expectedDigest: first.output.digest,
  }),
  { mode: 0o600 },
)
const refreshed = await read()
assert.notEqual(first.access.url, refreshed.access.url)
assert.deepEqual(first.output, refreshed.output)
const fresh = await fetch(refreshed.access.url, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
})
assert.equal(fresh.status, 200)
const chunks = []
let total = 0
for await (const chunk of fresh.body) {
  total += chunk.length
  assert.ok(total <= 134217728, "Rendered output exceeds bound")
  chunks.push(chunk)
}
const bytes = Buffer.concat(chunks, total)
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  refreshed.output.digest,
)
const evidence = {
  fixtureOnly: true,
  projectId,
  attemptId,
  revision: refreshed.revision,
  expiredStatus: expired.status,
  refreshedStatus: fresh.status,
  output: refreshed.output,
  bytes: bytes.length,
  checkedAt: new Date().toISOString(),
}
await writeFile(
  join(output, "media-expiry-evidence.json"),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 },
)
console.log(
  "Expired access rejected; fresh MCP grant returned identical verified output. No live bearer URL persisted; an expired fixture is available for client recovery.",
)
