import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { VmJournal } from "../src/vm/journal.mjs"
import { readCycleState } from "../src/vm/cycle-state.mjs"
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "studio-cycle-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journal = new VmJournal(directory),
    binding = await journal.claimRequest({ poolId: "pool", workerId: "worker" })
  await journal.assignment(
    {
      ...binding,
      attemptId: "attempt",
      leaseId: randomUUID(),
      expiresAt: Date.now() + 1200000,
    },
    {
      bootId: (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim(),
      deadlineMs: Number(process.hrtime.bigint() / 1000000n) + 900000,
      renderImage: "sha256:" + "a".repeat(64),
      verifyImage: "sha256:" + "b".repeat(64),
    },
  )
  return { directory, journal, id: binding.dispatchId.replaceAll("-", "") }
}
test("truthy malformed complete/retired records never skip an unfinished cycle", async (t) => {
  for (const name of ["complete.json", "retired.json"])
    for (const value of [{}, false, 0, "", []]) {
      const f = await fixture(t)
      await writeFile(join(f.directory, name), JSON.stringify(value), {
        mode: 0o600,
      })
      await assert.rejects(readCycleState(f.journal), /terminal|retirement/)
    }
})
test("completion requires exact retirement prerequisites and a persisted sealed record", async (t) => {
  const f = await fixture(t)
  await f.journal.writeOnce("retired.json", { id: f.id, complete: true })
  await f.journal.writeOnce("complete.json", {
    id: f.id,
    receipt: { admitted: false },
  })
  await assert.rejects(readCycleState(f.journal), /settlement/)
  await f.journal.writeOnce("settlement.json", {
    settlement: "a".repeat(64) + "." + "b".repeat(43),
  })
  assert.equal((await readCycleState(f.journal)).complete, true)
})
test("a scoped retirement marker cannot bypass missing runtime reconciliation", async (t) => {
  const f = await fixture(t)
  const record = await f.journal.issued()
  await f.journal.writeOnce("scope.json", {
    bootId: record.binding.bootId,
    deadlineMs: record.deadlineMs,
    cgroupInode: "1",
  })
  await f.journal.writeOnce("retired.json", { id: f.id, complete: true })
  await assert.rejects(readCycleState(f.journal), /reconciliation/)
})
test("large artifacts survive unresolved work and are pruned only after validated retirement and receipt", async (t) => {
  const { pruneCycleArtifacts } = await import("../src/vm/cycle-artifacts.mjs")
  const { mkdir, access } = await import("node:fs/promises")
  const f = await fixture(t),
    root = await mkdtemp(join(tmpdir(), "studio-artifacts-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const job = join(root, f.id)
  await mkdir(job, { mode: 0o700 })
  await writeFile(join(job, "output.mp4"), "video")
  await mkdir(join(job, "render-input"))
  await writeFile(join(job, "render-input", "input.json"), "{}")
  await writeFile(join(job, "retired"), "")
  await assert.rejects(pruneCycleArtifacts(f.journal, root), /receipt/)
  await access(join(job, "output.mp4"))
  await f.journal.writeOnce("retired.json", { id: f.id, complete: true })
  await f.journal.writeOnce("settlement.json", {
    settlement: "a".repeat(64) + "." + "b".repeat(43),
  })
  await f.journal.writeOnce("complete.json", {
    id: f.id,
    receipt: { admitted: true },
  })
  await pruneCycleArtifacts(f.journal, root)
  await pruneCycleArtifacts(f.journal, root)
  await assert.rejects(access(join(job, "output.mp4")), /ENOENT/)
  await assert.rejects(access(join(job, "render-input")), /ENOENT/)
  await access(join(job, "retired"))
  assert.equal((await readCycleState(f.journal)).complete, true)
})
