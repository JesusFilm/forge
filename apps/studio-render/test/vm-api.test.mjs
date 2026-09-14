import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { VmJournal } from "../src/vm/journal.mjs"
import { VmJobApi } from "../src/vm/job-api.mjs"

async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), "studio-vm-api-"))
  const server = createServer(handler)
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const config = {
    endpoint: `http://127.0.0.1:${server.address().port}/owned`,
    fixtureHttp: true,
    token: "owned-fixture-token-" + randomUUID(),
    poolId: "pool",
    workerId: "worker",
    timeoutMs: 1000,
  }
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
    await rm(root, { recursive: true, force: true })
  })
  return { root, config, journal: new VmJournal(root) }
}
test("production requires HTTPS; fixture HTTP is loopback-only and credentials cannot be in URLs", () => {
  const config = { token: "x".repeat(40), poolId: "pool", workerId: "worker" }
  assert.throws(
    () => new VmJobApi({ ...config, endpoint: "http://127.0.0.1:1234/owned" }),
    /HTTPS/,
  )
  assert.throws(
    () =>
      new VmJobApi({
        ...config,
        endpoint: "http://10.2.1.100:1234/owned",
        fixtureHttp: true,
      }),
    /loopback/,
  )
  assert.throws(
    () =>
      new VmJobApi({
        ...config,
        endpoint: "https://user:secret@example.com/owned",
      }),
    /endpoint/,
  )
})
test("lost claim response retries the exact identity that was durable before network", async (t) => {
  const requests = [],
    leaseId = randomUUID()
  let owned
  owned = await fixture(t, async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    const persisted = JSON.parse(
      await readFile(join(owned.root, "claim-request.json")),
    )
    assert.equal(request.dispatchId, persisted.dispatchId)
    assert.equal(req.headers.authorization, `Bearer ${owned.config.token}`)
    requests.push(request)
    if (requests.length === 1) {
      res.destroy()
      return
    }
    res.setHeader("content-type", "application/json")
    res.end(
      JSON.stringify({
        execute: true,
        capability: "a".repeat(64) + "." + "b".repeat(43),
        assignment: {
          ...persisted,
          attemptId: "attempt",
          leaseId,
          expiresAt: Date.now() + 1200000,
        },
      }),
    )
  })
  await assert.rejects(
    new VmJobApi(owned.config).claim(owned.journal),
    /unconfirmed/,
  )
  const result = await new VmJobApi(owned.config).claim(
    new VmJournal(owned.root),
  )
  assert.equal(result.assignment.leaseId, leaseId)
  assert.deepEqual(requests[1], requests[0])
})
test("redirect is refused without forwarding credentials or exposing response text", async (t) => {
  let redirected = 0
  const owned = await fixture(t, (req, res) => {
    if (req.url === "/steal") {
      redirected++
      res.end("secret payload")
      return
    }
    res.writeHead(302, { location: "/steal" })
    res.end("secret payload")
  })
  await assert.rejects(
    new VmJobApi(owned.config).claim(owned.journal),
    (error) => error.message === "Job API request unconfirmed",
  )
  assert.equal(redirected, 0)
})
test("hung responses are bounded and preserve the request for reconciliation", async (t) => {
  const owned = await fixture(t, () => {})
  await assert.rejects(
    new VmJobApi({ ...owned.config, timeoutMs: 50 }).claim(owned.journal),
    /unconfirmed/,
  )
  const persisted = JSON.parse(
    await readFile(join(owned.root, "claim-request.json")),
  )
  assert.ok(persisted.dispatchId)
})
test("lease operations never send the host worker key and require an exact-lease transport capability", async (t) => {
  const headers = []
  const owned = await fixture(t, (req, res) => {
    headers.push(req.headers.authorization)
    res.end("false")
  })
  const api = new VmJobApi(owned.config)
  await assert.rejects(api.json("owns", {}, undefined), /capability/)
  assert.equal(headers.length, 0)
  const capability = "a".repeat(64) + "." + "b".repeat(43)
  assert.equal(await api.json("owns", {}, undefined, capability), false)
  assert.deepEqual(headers, [`Bearer ${capability}`])
})
test("a slow valid lease response survives Internet latency without another request", async (t) => {
  let requests = 0
  let timer
  const owned = await fixture(t, (req, res) => {
    requests++
    timer = setTimeout(() => res.end("true"), 6000)
  })
  t.after(() => clearTimeout(timer))
  const capability = "a".repeat(64) + "." + "b".repeat(43)
  assert.equal(
    await new VmJobApi(owned.config).json("owns", {}, undefined, capability),
    true,
  )
  assert.equal(requests, 1)
})
test("caller cancellation still interrupts a pending lease check", async (t) => {
  const owned = await fixture(t, () => {})
  const capability = "a".repeat(64) + "." + "b".repeat(43)
  await assert.rejects(
    new VmJobApi(owned.config).json(
      "owns",
      {},
      AbortSignal.timeout(50),
      capability,
    ),
    /unconfirmed/,
  )
})
test("lost finish response replays the durably sealed record on restart without a new retain or execution", async (t) => {
  let owned
  const seen = []
  const settlement = "a".repeat(64) + "." + "b".repeat(43)
  owned = await fixture(t, async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.deepEqual(
      JSON.parse(await readFile(join(owned.root, "settlement.json"))),
      request,
    )
    seen.push(request)
    if (seen.length === 1) {
      res.destroy()
      return
    }
    res.end(JSON.stringify({ admitted: true }))
  })
  const api = new VmJobApi(owned.config),
    capability = "c".repeat(64) + "." + "d".repeat(43)
  await assert.rejects(
    api.finish(owned.journal, capability, { settlement }),
    /unconfirmed/,
  )
  const result = await new VmJobApi(owned.config).finish(
    new VmJournal(owned.root),
    capability,
    { settlement },
  )
  assert.deepEqual(result, { admitted: true })
  assert.deepEqual(seen[0], seen[1])
  await assert.rejects(
    api.finish(owned.journal, capability, {
      settlement: "e".repeat(64) + "." + "f".repeat(43),
    }),
    /Changed terminal/,
  )
  assert.equal(seen.length, 2)
})
test("non-OK streaming responses are cancelled promptly without consuming or exposing error bytes", async (t) => {
  let closed = false
  const owned = await fixture(t, (req, res) => {
    res.writeHead(503, { "content-type": "text/plain" })
    res.write("secret error bytes")
    res.once("close", () => {
      closed = true
    })
  })
  await assert.rejects(
    new VmJobApi(owned.config).claim(owned.journal),
    (error) => error.message === "Job API request unconfirmed",
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(closed, true)
})
