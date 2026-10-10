import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { VmJournal } from "../src/vm/journal.mjs"

const currentBoot = (
  await readFile("/proc/sys/kernel/random/boot_id", "utf8")
).trim()
const deadline = () => Number(process.hrtime.bigint() / 1000000n) + 60000
const binding = { poolId: "owned-pool", workerId: "owned-worker" }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "studio-vm-journal-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, journal: new VmJournal(root) }
}
test("claim identity is durable before transport and reused after restart", async (t) => {
  const { root, journal } = await fixture(t)
  const request = await journal.claimRequest(binding)
  assert.equal(
    JSON.parse(await readFile(join(root, "claim-request.json"))).dispatchId,
    request.dispatchId,
  )
  assert.deepEqual(await new VmJournal(root).claimRequest(binding), request)
  await assert.rejects(
    journal.claimRequest({ ...binding, workerId: "other" }),
    /binding/,
  )
})
test("duplicate assignment preserves original deadline and refuses changed lease or image", async (t) => {
  const { root, journal } = await fixture(t)
  const request = await journal.claimRequest(binding)
  const assignment = {
    ...request,
    attemptId: "attempt",
    leaseId: randomUUID(),
    expiresAt: Date.now() + 1200000,
  }
  const runtime = {
    bootId: currentBoot,
    deadlineMs: deadline(),
    renderImage: `sha256:${"a".repeat(64)}`,
    verifyImage: `sha256:${"b".repeat(64)}`,
  }
  const first = await journal.assignment(assignment, runtime)
  assert.deepEqual(
    await new VmJournal(root).assignment(assignment, {
      ...runtime,
      deadlineMs: deadline() + 60000,
    }),
    first,
  )
  await assert.rejects(
    journal.assignment({ ...assignment, leaseId: randomUUID() }, runtime),
    /binding/,
  )
  await assert.rejects(
    journal.assignment(assignment, {
      ...runtime,
      renderImage: `sha256:${"c".repeat(64)}`,
    }),
    /binding/,
  )
  await assert.rejects(
    new VmJournal(root).assignment(assignment, {
      ...runtime,
      bootId: randomUUID(),
      deadlineMs: 999999,
    }),
    /binding/,
  )
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "assignment.json"))),
    first,
  )
})
test("two processes can consume each Docker operation only once, including ambiguous restart", async (t) => {
  const { root, journal } = await fixture(t)
  const request = await journal.claimRequest(binding)
  const assignment = {
    ...request,
    attemptId: "attempt",
    leaseId: randomUUID(),
    expiresAt: Date.now() + 1200000,
  }
  await journal.assignment(assignment, {
    bootId: currentBoot,
    deadlineMs: deadline(),
    renderImage: `sha256:${"a".repeat(64)}`,
    verifyImage: `sha256:${"b".repeat(64)}`,
  })
  const module = new URL("../src/vm/journal.mjs", import.meta.url).href
  async function consume() {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {VmJournal} from ${JSON.stringify(module)}; let admitted; try { admitted=await new VmJournal(process.argv[1]).beginOperation('render','create'); } catch(error) { if(error.message!=='Journal persistence unconfirmed') throw error; admitted=false; } process.stdout.write(JSON.stringify(admitted));`,
        root,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
    let output = "",
      error = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      error += chunk
    })
    await new Promise((resolve, reject) => {
      child.on("error", reject)
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(error)),
      )
    })
    return JSON.parse(output)
  }
  assert.deepEqual((await Promise.all([consume(), consume()])).sort(), [
    false,
    true,
  ])
  // A lost Docker create response does not make the persisted intent reusable.
  assert.equal(
    await new VmJournal(root).beginOperation("render", "create"),
    false,
  )
  await assert.rejects(journal.beginOperation("render", "start"), /unconfirmed/)
  await journal.created("render", "d".repeat(64))
  assert.equal(await journal.beginOperation("render", "start"), true)
  assert.equal(
    await new VmJournal(root).beginOperation("render", "start"),
    false,
  )
  await assert.rejects(
    journal.beginOperation("untrusted", "start"),
    /operation/,
  )
})
test("torn claim, assignment and operation records refuse execution and remain preserved", async (t) => {
  for (const name of [
    "claim-request.json",
    "assignment.json",
    "render-create-intent.json",
    ".pending-interrupted-write",
  ]) {
    const { root, journal } = await fixture(t)
    const request = await journal.claimRequest(binding)
    const assignment = {
      ...request,
      attemptId: "attempt",
      leaseId: randomUUID(),
      expiresAt: Date.now() + 1200000,
    }
    const runtime = {
      bootId: currentBoot,
      deadlineMs: deadline(),
      renderImage: `sha256:${"a".repeat(64)}`,
      verifyImage: `sha256:${"b".repeat(64)}`,
    }
    if (name !== "claim-request.json")
      await journal.assignment(assignment, runtime)
    await writeFile(join(root, name), "{partial", { mode: 0o600 })
    if (name === "claim-request.json")
      await assert.rejects(journal.claimRequest(binding))
    else await assert.rejects(journal.beginOperation("render", "create"))
    assert.equal(await readFile(join(root, name), "utf8"), "{partial")
  }
})
test("operation admission refuses a persisted old-boot clock even without another claim response", async (t) => {
  const { root, journal } = await fixture(t)
  const request = await journal.claimRequest(binding)
  const old = await journal.assignment(
    {
      ...request,
      attemptId: "attempt",
      leaseId: randomUUID(),
      expiresAt: Date.now() + 1200000,
    },
    {
      bootId: randomUUID(),
      deadlineMs: deadline(),
      renderImage: `sha256:${"a".repeat(64)}`,
      verifyImage: `sha256:${"b".repeat(64)}`,
    },
  )
  await assert.rejects(
    new VmJournal(root).beginOperation("render", "create"),
    /changed boot/,
  )
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "assignment.json"))),
    old,
  )
})
test("valid JSON with malformed binding or unconfirmed CID still refuses execution", async (t) => {
  for (const name of ["assignment.json", "render-created.json"]) {
    const { root, journal } = await fixture(t)
    const request = await journal.claimRequest(binding)
    const record = await journal.assignment(
      {
        ...request,
        attemptId: "attempt",
        leaseId: randomUUID(),
        expiresAt: Date.now() + 1200000,
      },
      {
        bootId: currentBoot,
        deadlineMs: deadline(),
        renderImage: `sha256:${"a".repeat(64)}`,
        verifyImage: `sha256:${"b".repeat(64)}`,
      },
    )
    await journal.beginOperation("render", "create")
    await journal.created("render", "d".repeat(64))
    const bytes = JSON.stringify(
      name === "assignment.json"
        ? {
            ...record,
            binding: { ...record.binding, renderImage: "mutable:tag" },
          }
        : {},
    )
    await writeFile(join(root, name), bytes, { mode: 0o600 })
    await assert.rejects(journal.beginOperation("render", "start"))
    assert.equal(await readFile(join(root, name), "utf8"), bytes)
  }
})
test("failed confirmation preserves its temporary persistence evidence", async (t) => {
  const { root } = await fixture(t)
  class UnreadableJournal extends VmJournal {
    async read() {
      throw new Error("Controlled failed record read")
    }
  }
  await assert.rejects(
    new UnreadableJournal(root).claimRequest(binding),
    /failed record read/,
  )
  assert.equal(
    (await readdir(root)).filter((name) => name.startsWith(".pending-")).length,
    1,
  )
  await assert.rejects(
    new VmJournal(root).claimRequest(binding),
    /persistence unconfirmed/,
  )
})
test("late storage completion consumes the intent but never returns launch admission after expiry", async (t) => {
  const { root, journal } = await fixture(t)
  const request = await journal.claimRequest(binding)
  const shortDeadline = Number(process.hrtime.bigint() / 1000000n) + 150
  await journal.assignment(
    {
      ...request,
      attemptId: "attempt",
      leaseId: randomUUID(),
      expiresAt: Date.now() + 1200000,
    },
    {
      bootId: currentBoot,
      deadlineMs: shortDeadline,
      renderImage: `sha256:${"a".repeat(64)}`,
      verifyImage: `sha256:${"b".repeat(64)}`,
    },
  )
  class LateStorageJournal extends VmJournal {
    async writeOnce(name, value) {
      const result = await super.writeOnce(name, value)
      await new Promise((done) => setTimeout(done, 170))
      return result
    }
  }
  await assert.rejects(
    new LateStorageJournal(root).beginOperation("render", "create"),
    /expired/,
  )
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "render-create-intent.json"))),
    { phase: "render", operation: "create" },
  )
})
