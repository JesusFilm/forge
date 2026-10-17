import { Buffer } from "node:buffer"
import assert from "node:assert/strict"
import test from "node:test"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { VmJournal } from "../src/vm/journal.mjs"
import { VmJobApi } from "../src/vm/job-api.mjs"
import {
  settleVmOutput,
  outputPartBytes,
  outputMaxParts,
} from "../src/vm/retention.mjs"
import { VmUnconfirmedError } from "../src/vm/errors.mjs"
import {
  STUDIO_RENDER_OUTPUT_PART_BYTES,
  STUDIO_RENDER_OUTPUT_MAX_PARTS,
  studioRenderOutputPartSchema,
} from "../../../packages/studio-contracts/src/render.ts"

const { AbortController, setTimeout } = globalThis
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const capability = "c".repeat(64) + "." + "d".repeat(43)
const settlement = "a".repeat(64) + "." + "b".repeat(43)
const bootId =
  "a".repeat(8) +
  "-" +
  "b".repeat(4) +
  "-" +
  "c".repeat(4) +
  "-" +
  "d".repeat(4) +
  "-" +
  "e".repeat(12)
const claim = { capability }
const initialWall = 1700000000000
const transferDeadlineAt = initialWall + 45000
const ref = (bytes, index) => ({
  assetId: `part-${index}`,
  versionId: "v1",
  digest: hash(bytes),
})
async function fixture(t, bytes = Buffer.from("exact video output")) {
  const directory = await mkdtemp(join(tmpdir(), "studio-retention-"))
  const journal = new VmJournal(directory)
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, "output.mp4"), bytes)
  await writeFile(
    join(directory, "proof.json"),
    JSON.stringify({ outputDigest: hash(bytes), frames: 8856 }),
  )
  await journal.writeOnce("verified-output.json", {
    bytes: bytes.length,
    digest: hash(bytes),
  })
  let clock = 1000
  const calls = []
  const api = {
    async json(action, body, signal, cap) {
      assert.equal(cap, capability)
      signal?.throwIfAborted()
      calls.push({ action, body, signal })
      if (action === "receipt") return null
      if (action === "retain-part")
        return { part: ref(Buffer.from(body.output, "base64"), body.index) }
      if (action === "retain") return { settlement }
      assert.fail(action)
    },
    async finish(journal, cap, body, signal) {
      calls.push({ action: "finish", body, signal })
      assert.equal(cap, capability)
      assert.deepEqual(await journal.read("settlement.json"), body)
      signal.throwIfAborted()
      return { admitted: true }
    },
  }
  const options = {
    journal,
    api,
    claim,
    outputDirectory: directory,
    now: () => clock,
    boot: async () => bootId,
    wallNow: () => initialWall + clock - 1000,
  }
  return {
    directory,
    journal,
    calls,
    api,
    options,
    clock: (value) => {
      clock = value
    },
  }
}
async function httpApi(t, handler) {
  const server = createServer(handler)
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  })
  return new VmJobApi({
    endpoint: `http://127.0.0.1:${server.address().port}/`,
    fixtureHttp: true,
    token: "fixture-" + randomUUID(),
    poolId: "pool",
    workerId: "worker",
  })
}

test("fixed VM bounds match contracts and exact ordered part bodies validate", async (t) => {
  assert.equal(outputPartBytes, STUDIO_RENDER_OUTPUT_PART_BYTES)
  assert.equal(outputMaxParts, STUDIO_RENDER_OUTPUT_MAX_PARTS)
  const f = await fixture(t, Buffer.alloc(outputPartBytes + 7, 123))
  assert.deepEqual(await settleVmOutput(f.options), { admitted: true })
  const parts = f.calls.filter((call) => call.action === "retain-part")
  assert.equal(parts.length, 2)
  const chunks = parts.map(({ body }, index) => {
    const { output, ...metadata } = body
    assert.equal(studioRenderOutputPartSchema.safeParse(metadata).success, true)
    assert.equal(body.index, index)
    assert.equal(body.count, 2)
    assert.equal(body.retentionDeadlineMs, transferDeadlineAt)
    const bytes = Buffer.from(output, "base64")
    assert.equal(bytes.length, body.byteSize)
    return bytes
  })
  assert.deepEqual(
    Buffer.concat(chunks),
    await readFile(join(f.directory, "output.mp4")),
  )
  const final = f.calls.find((call) => call.action === "retain").body
  assert.deepEqual(Object.keys(final), ["status", "parts", "proof"])
  assert.deepEqual(final.parts, chunks.map(ref))
  assert.equal(final.proof.outputDigest, hash(Buffer.concat(chunks)))
})

test("106,963,325-byte incident-size output crosses actual HTTP below edge cap; old full JSON is rejected", async (t) => {
  // Transport regression: actual full-sized bytes/envelopes, not codec acceptance.
  const output = Buffer.alloc(106963325)
  for (let offset = 0; offset < output.length; offset += 4096)
    output.writeUInt32LE(offset, offset)
  const f = await fixture(t, output)
  const sizes = [],
    parts = []
  let legacyBytes = 0
  const api = await httpApi(t, async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${capability}`)
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size <= 100 * 1024 * 1024) chunks.push(chunk)
    }
    if (size > 100 * 1024 * 1024) {
      legacyBytes = size
      res.writeHead(413).end()
      return
    }
    const raw = Buffer.concat(chunks).toString("utf8")
    const body = JSON.parse(raw)
    if (req.url === "/receipt") return res.end("null")
    sizes.push(size)
    if (req.url === "/retain-part") {
      const { output: encoded, ...metadata } = body
      assert.equal(
        studioRenderOutputPartSchema.safeParse(metadata).success,
        true,
      )
      const bytes = Buffer.from(encoded, "base64")
      assert.equal(bytes.length, body.byteSize)
      assert.equal(body.index, parts.length)
      parts.push({
        part: ref(bytes, body.index),
        digest: body.outputDigest,
        bytes,
      })
      return res.end(JSON.stringify({ part: parts.at(-1).part }))
    }
    if (req.url === "/retain") {
      assert.deepEqual(
        body.parts,
        parts.map(({ part }) => part),
      )
      const actual = createHash("sha256")
      for (const part of parts) actual.update(part.bytes)
      assert.equal(actual.digest("hex"), body.proof.outputDigest)
      assert.ok(size < 65536)
      return res.end(JSON.stringify({ settlement }))
    }
    assert.equal(req.url, "/finish")
    assert.deepEqual(body, { settlement })
    res.end(JSON.stringify({ admitted: true }))
  })
  await assert.rejects(
    api.json(
      "retain",
      { status: "SUCCEEDED", output: output.toString("base64"), proof: {} },
      undefined,
      capability,
    ),
    /unconfirmed/,
  )
  assert.ok(legacyBytes > 142000000)
  assert.deepEqual(await settleVmOutput({ ...f.options, api }), {
    admitted: true,
  })
  assert.equal(parts.length, 7)
  assert.equal(
    parts.reduce((sum, part) => sum + part.bytes.length, 0),
    output.length,
  )
  assert.ok(sizes.every((size) => size < 23 * 1024 * 1024))
  assert.equal(parts.at(-1).bytes.length, output.length - 6 * outputPartBytes)
})

test("lost part and final responses replay identical bytes and original window", async (t) => {
  const f = await fixture(t)
  const json = f.api.json.bind(f.api),
    seen = new Map()
  f.api.json = async (action, body, signal, cap) => {
    if (action === "retain-part" || action === "retain") {
      const wire = JSON.stringify(body)
      if (!seen.has(action)) {
        seen.set(action, wire)
        throw new VmUnconfirmedError("lost response")
      }
      assert.equal(wire, seen.get(action))
    }
    return json(action, body, signal, cap)
  }
  assert.deepEqual(await settleVmOutput(f.options), { admitted: true })
  assert.deepEqual(await f.journal.read("retention-window.json"), {
    bootId,
    deadlineMs: 61000,
    transferDeadlineAt,
  })
})

test("restart reuses confirmed parts, revalidates bytes and never renews window", async (t) => {
  const f = await fixture(t, Buffer.alloc(outputPartBytes + 3, 42))
  const json = f.api.json.bind(f.api)
  f.api.json = async (action, body, signal, cap) => {
    if (action === "retain-part" && body.index === 1)
      throw new VmUnconfirmedError("response lost")
    return json(action, body, signal, cap)
  }
  await assert.rejects(settleVmOutput(f.options), /lost/)
  assert.ok(await f.journal.read("retention-part-0.json"))
  f.clock(5000)
  f.options.wallNow = () => initialWall + 86400000
  f.api.json = json
  f.calls.length = 0
  await settleVmOutput(f.options)
  const restartedParts = f.calls.filter((call) => call.action === "retain-part")
  assert.deepEqual(
    restartedParts.map(({ body }) => body.index),
    [1],
  )
  assert.equal(restartedParts[0].body.retentionDeadlineMs, transferDeadlineAt)
  assert.equal(
    (await f.journal.read("retention-window.json")).transferDeadlineAt,
    transferDeadlineAt,
  )
  assert.equal(
    (await f.journal.read("retention-window.json")).deadlineMs,
    61000,
  )
})

test("cancellation between parts preserves bytes and stops later mutations", async (t) => {
  const f = await fixture(t, Buffer.alloc(outputPartBytes + 1, 1))
  const controller = new AbortController(),
    json = f.api.json.bind(f.api)
  f.api.json = async (...args) => {
    const result = await json(...args)
    if (args[0] === "retain-part") controller.abort()
    return result
  }
  await assert.rejects(
    settleVmOutput({ ...f.options, signal: controller.signal }),
    /interrupted/,
  )
  assert.deepEqual(
    f.calls.map(({ action }) => action),
    ["receipt", "retain-part"],
  )
  assert.equal(
    (await readFile(join(f.directory, "output.mp4"))).length,
    outputPartBytes + 1,
  )
})

test("all parts and final share 45 seconds; restart cannot acquire another allowance", async (t) => {
  const f = await fixture(t, Buffer.alloc(outputPartBytes + 1))
  const json = f.api.json.bind(f.api)
  f.api.json = async (...args) => {
    const result = await json(...args)
    if (args[0] === "retain-part") f.clock(46001)
    return result
  }
  await assert.rejects(settleVmOutput(f.options), /allowance exhausted/)
  f.api.json = json
  await assert.rejects(settleVmOutput(f.options), /allowance exhausted/)
  assert.equal(
    f.calls.filter(({ action }) => action === "retain-part").length,
    1,
  )
  assert.equal(
    f.calls.some(({ action }) => action === "retain"),
    false,
  )
  assert.equal(
    (await f.journal.read("retention-window.json")).deadlineMs,
    61000,
  )
})

test("canonical recovery precedes expired/changed-boot window and needs no local output", async (t) => {
  for (const admitted of [true, false]) {
    const f = await fixture(t)
    await f.journal.writeOnce("retention-window.json", {
      bootId: randomUUID(),
      deadlineMs: 1,
      transferDeadlineAt,
    })
    await rm(join(f.directory, "output.mp4"))
    f.clock(90000)
    f.api.json = async (action, body, signal, cap) => {
      assert.equal(action, "receipt")
      assert.deepEqual(body, {})
      assert.equal(signal, undefined)
      assert.equal(cap, capability)
      return { settlement, receipt: { admitted } }
    }
    assert.deepEqual(await settleVmOutput(f.options), { admitted })
    assert.deepEqual(await f.journal.read("settlement.json"), { settlement })
    assert.equal((await f.journal.read("retention-window.json")).deadlineMs, 1)
  }
})

test("null/malformed canonical recovery cannot renew expired window or create settlement", async (t) => {
  for (const recovered of [
    null,
    { settlement, receipt: { admitted: "true" } },
    { settlement: "unsigned", receipt: { admitted: true } },
  ]) {
    const f = await fixture(t)
    await f.journal.writeOnce("retention-window.json", {
      bootId,
      deadlineMs: 1,
      transferDeadlineAt,
    })
    f.api.json = async (action) => {
      assert.equal(action, "receipt")
      return recovered
    }
    await assert.rejects(
      settleVmOutput(f.options),
      /exhausted|Malformed canonical recovery/,
    )
    assert.equal(await f.journal.read("settlement.json"), null)
    assert.equal((await f.journal.read("retention-window.json")).deadlineMs, 1)
  }
})

test("changed output/proof and corrupt part responses fail before final retention", async (t) => {
  for (const corruption of ["output", "proof", "part", "journal"]) {
    const f = await fixture(t)
    if (corruption === "output")
      await writeFile(join(f.directory, "output.mp4"), Buffer.alloc(18, 9))
    if (corruption === "proof")
      await writeFile(
        join(f.directory, "proof.json"),
        JSON.stringify({ outputDigest: "0".repeat(64) }),
      )
    if (corruption === "part")
      f.api.json = async (action) =>
        action === "receipt" ? null : { part: ref(Buffer.from("wrong"), 0) }
    if (corruption === "journal")
      await f.journal.writeOnce("retention-part-0.json", { index: 1 })
    await assert.rejects(
      settleVmOutput(f.options),
      /changed|Malformed retained part|Changed retained part/,
    )
    assert.equal(
      f.calls.some(({ action }) => action === "retain"),
      false,
    )
  }
})

test("lost finish response recovers its durable signed record without replaying mutations", async (t) => {
  const f = await fixture(t)
  const json = f.api.json.bind(f.api)
  f.api.finish = async () => {
    throw new VmUnconfirmedError("lost finish")
  }
  f.api.json = async (action, body, ...args) => {
    if (action === "receipt" && body.settlement) return { admitted: true }
    return json(action, body, ...args)
  }
  assert.deepEqual(await settleVmOutput(f.options), { admitted: true })
  assert.deepEqual(await f.journal.read("settlement.json"), { settlement })
  f.calls.length = 0
  assert.deepEqual(await settleVmOutput(f.options), { admitted: true })
  assert.deepEqual(f.calls, [])
})

test("failed output retains the original status-only protocol", async (t) => {
  const f = await fixture(t)
  await rm(join(f.directory, "verified-output.json"))
  await settleVmOutput(f.options)
  assert.deepEqual(
    f.calls.map(({ action }) => action),
    ["receipt", "retain", "finish"],
  )
  assert.deepEqual(f.calls[1].body, { status: "FAILED" })
})

test("actual HTTP response loss retries byte-identical parts/final and reads a lost finish receipt", async (t) => {
  const f = await fixture(t)
  const requests = new Map()
  let committed = false
  const api = await httpApi(t, async (req, res) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(req.headers.authorization, `Bearer ${capability}`)
    if (req.url === "/receipt") {
      if (body.settlement) {
        assert.equal(body.settlement, settlement)
        assert.equal(committed, true)
        return res.end(JSON.stringify({ admitted: true }))
      }
      return res.end("null")
    }
    const seen = requests.get(req.url) ?? []
    seen.push(raw)
    requests.set(req.url, seen)
    if (req.url === "/finish") {
      assert.deepEqual(await f.journal.read("settlement.json"), body)
      committed = true
      res.destroy()
      return
    }
    if (seen.length === 1) {
      res.destroy()
      return
    }
    assert.equal(seen[0], raw)
    if (req.url === "/retain-part")
      return res.end(
        JSON.stringify({
          part: ref(Buffer.from(body.output, "base64"), body.index),
        }),
      )
    assert.equal(req.url, "/retain")
    res.end(JSON.stringify({ settlement }))
  })
  assert.deepEqual(await settleVmOutput({ ...f.options, api }), {
    admitted: true,
  })
  assert.equal(requests.get("/retain-part").length, 2)
  assert.equal(requests.get("/retain").length, 2)
  assert.equal(requests.get("/finish").length, 1)
  assert.equal(
    (await f.journal.read("retention-window.json")).deadlineMs,
    61000,
  )
})

test("caller cancellation aborts an in-flight actual part request and sends no final retain", async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  const paths = []
  let closed
  const connectionClosed = new Promise((resolve) => {
    closed = resolve
  })
  const api = await httpApi(t, async (req, res) => {
    for await (const chunk of req) {
      assert.ok(chunk.length > 0)
    }
    paths.push(req.url)
    if (req.url === "/receipt") return res.end("null")
    assert.equal(req.url, "/retain-part")
    res.once("close", closed)
    controller.abort()
  })
  await assert.rejects(
    settleVmOutput({ ...f.options, api, signal: controller.signal }),
    /unconfirmed/,
  )
  await connectionClosed
  assert.deepEqual(paths, ["/receipt", "/retain-part"])
  assert.equal(await f.journal.read("settlement.json"), null)
})

test("initial recovery latency consumes the original window and leaves the recording reserve", async (t) => {
  const f = await fixture(t)
  const json = f.api.json.bind(f.api)
  f.api.json = async (...args) => {
    const result = await json(...args)
    if (args[0] === "receipt") f.clock(46001)
    return result
  }
  await assert.rejects(settleVmOutput(f.options), /allowance exhausted/)
  assert.equal(
    (await f.journal.read("retention-window.json")).deadlineMs,
    61000,
  )
  assert.equal(
    (await f.journal.read("retention-window.json")).transferDeadlineAt,
    transferDeadlineAt,
  )
  assert.deepEqual(
    f.calls.map(({ action }) => action),
    ["receipt"],
  )
})

test("recording is cancelled at the original 60-second deadline, with read-only receipt recovery afterward", async (t) => {
  const f = await fixture(t)
  // Move near expiry only AFTER final retention returns inside its 45s budget.
  const writeOnce = f.journal.writeOnce.bind(f.journal)
  f.journal.writeOnce = async (name, value) => {
    const result = await writeOnce(name, value)
    if (name === "settlement.json") f.clock(60975)
    return result
  }
  f.api.finish = async (_journal, _cap, _body, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(signal.aborted, true)
    throw new VmUnconfirmedError("recording timed out")
  }
  await assert.rejects(
    settleVmOutput(f.options),
    /Canonical terminal recording unconfirmed/,
  )
  assert.deepEqual(f.calls.at(-1).body, { settlement })
  assert.equal(f.calls.at(-1).action, "receipt")
  assert.equal(f.calls.at(-1).signal, undefined)
  assert.equal(
    (await f.journal.read("retention-window.json")).deadlineMs,
    61000,
  )
})

test("a changed proof cannot alter an uncertain final request on restart", async (t) => {
  const f = await fixture(t)
  const json = f.api.json.bind(f.api)
  let attempts = 0
  f.api.json = async (action, ...args) => {
    if (action === "retain") {
      attempts++
      throw new VmUnconfirmedError("lost final response")
    }
    return json(action, ...args)
  }
  await assert.rejects(settleVmOutput(f.options), /lost final response/)
  assert.equal(attempts, 2)
  const proofPath = join(f.directory, "proof.json")
  const proof = JSON.parse(await readFile(proofPath, "utf8"))
  await writeFile(proofPath, JSON.stringify({ ...proof, frames: 1 }))
  await assert.rejects(settleVmOutput(f.options), /Changed retention request/)
  assert.equal(attempts, 2)
  assert.equal(await f.journal.read("settlement.json"), null)
})

test("unresolved old or malformed wall-deadline windows fail closed without renewal", async (t) => {
  for (const field of [
    undefined,
    0,
    -1,
    "later",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const f = await fixture(t)
    const original = {
      bootId,
      deadlineMs: 61000,
      ...(field === undefined ? {} : { transferDeadlineAt: field }),
    }
    await f.journal.writeOnce("retention-window.json", original)
    await assert.rejects(
      settleVmOutput(f.options),
      /Malformed retention window/,
    )
    assert.deepEqual(await f.journal.read("retention-window.json"), original)
    assert.deepEqual(
      f.calls.map(({ action }) => action),
      ["receipt"],
    )
  }
})

test("an old two-key window still allows exact committed canonical recovery before validation", async (t) => {
  const f = await fixture(t)
  const original = { bootId: randomUUID(), deadlineMs: 1 }
  await f.journal.writeOnce("retention-window.json", original)
  f.api.json = async (action, body, signal) => {
    assert.equal(action, "receipt")
    assert.deepEqual(body, {})
    assert.equal(signal, undefined)
    return { settlement, receipt: { admitted: true } }
  }
  assert.deepEqual(await settleVmOutput(f.options), { admitted: true })
  assert.deepEqual(await f.journal.read("settlement.json"), { settlement })
  assert.deepEqual(await f.journal.read("retention-window.json"), original)
})
