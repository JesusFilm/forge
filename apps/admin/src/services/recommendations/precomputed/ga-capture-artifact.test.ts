import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import {
  canonicalGaCaptureJson,
  hasSealedGaCapture,
  verifyGaCaptureFile,
} from "./ga-capture-artifact"
import { sha, validArtifact } from "./ga-capture-artifact.test-fixture"
import { gaCaptureStorageKey } from "./ga-capture-store"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

it("accepts a sealed reference only for its own generation identity", () => {
  const bytes = validArtifact()
  const length = bytes.readUInt32BE(8)
  const header = JSON.parse(bytes.subarray(12, 12 + length).toString("utf8"))
  const scalars = { ...header }
  const baseQualification = scalars.baseQualification
  delete scalars.blocks
  delete scalars.baseQualification
  const reference = {
    ...scalars,
    storageKey: gaCaptureStorageKey("unit-generation", sha(bytes)),
    artifactSha256: sha(bytes),
    artifactBytes: bytes.length,
    headerSha256: sha(bytes.subarray(12, 12 + length)),
  }
  const identity = {
    id: "unit-generation",
    inputDigest: "a".repeat(64),
    sourceSetDigest: "b".repeat(64),
    inputCutoff: new Date("2026-10-06T00:00:00.000Z"),
  }
  expect(
    hasSealedGaCapture(
      { ...baseQualification, snapshotRef: reference },
      identity,
    ),
  ).toBe(true)
  expect(
    hasSealedGaCapture(
      { ...baseQualification, snapshotRef: reference },
      { ...identity, inputDigest: "f".repeat(64) },
    ),
  ).toBe(false)
})

it("verifies one bounded capture and rejects a changed compressed block", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
  roots.push(root)
  const file = join(root, "capture.bin")
  const bytes = validArtifact()
  await writeFile(file, bytes)
  const verified = await verifyGaCaptureFile(file, sha(bytes), bytes.length)
  expect(verified.header).toMatchObject({
    generationId: "unit-generation",
    physicalHttpAttempts: 7,
    physicalSucceededCalls: 6,
  })

  const changed = Buffer.from(bytes)
  changed[changed.length - 1] ^= 1
  await writeFile(file, changed)
  await expect(
    verifyGaCaptureFile(file, sha(changed), changed.length),
  ).rejects.toThrow(/block|gzip|digest/i)
})

it("rejects a self-hashed artifact with a false report digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
  roots.push(root)
  const original = validArtifact()
  const headerLength = original.readUInt32BE(8)
  const header = JSON.parse(
    original.subarray(12, 12 + headerLength).toString("utf8"),
  )
  header.startContentDigest = "0".repeat(64)
  const changedHeader = Buffer.from(canonicalGaCaptureJson(header))
  const prefix = Buffer.alloc(12)
  prefix.write("FORGEGA1")
  prefix.writeUInt32BE(changedHeader.length, 8)
  const changed = Buffer.concat([
    prefix,
    changedHeader,
    original.subarray(12 + headerLength),
  ])
  const file = join(root, "bad-report.bin")
  await writeFile(file, changed)
  await expect(
    verifyGaCaptureFile(file, sha(changed), changed.length),
  ).rejects.toThrow(/report counts\/digest/i)
})

it("rejects qualification totals unsupported by captured start rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
  roots.push(root)
  const original = validArtifact()
  const headerLength = original.readUInt32BE(8)
  const header = JSON.parse(
    original.subarray(12, 12 + headerLength).toString("utf8"),
  )
  header.baseQualification.watchScope.includedEvents = 1
  header.baseQualification.mediaComponentIdCoverage.inScopeEvents = 1
  header.baseQualificationDigest = sha(
    canonicalGaCaptureJson(header.baseQualification),
  )
  const changedHeader = Buffer.from(canonicalGaCaptureJson(header))
  const prefix = Buffer.alloc(12)
  prefix.write("FORGEGA1")
  prefix.writeUInt32BE(changedHeader.length, 8)
  const changed = Buffer.concat([
    prefix,
    changedHeader,
    original.subarray(12 + headerLength),
  ])
  const file = join(root, "bad-qualification.bin")
  await writeFile(file, changed)
  await expect(
    verifyGaCaptureFile(file, sha(changed), changed.length),
  ).rejects.toThrow(/qualification aggregate counts/i)
})

it("rejects excessive declared aggregate raw bytes before decompression", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
  roots.push(root)
  const original = validArtifact()
  const headerLength = original.readUInt32BE(8)
  const header = JSON.parse(
    original.subarray(12, 12 + headerLength).toString("utf8"),
  )
  const oversizedPage = { ...header.blocks[0], rawBytes: 8 * 1024 * 1024 }
  header.blocks = [
    ...Array.from({ length: 129 }, () => oversizedPage),
    ...header.blocks.slice(1),
  ]
  const changedHeader = Buffer.from(canonicalGaCaptureJson(header))
  const prefix = Buffer.alloc(12)
  prefix.write("FORGEGA1")
  prefix.writeUInt32BE(changedHeader.length, 8)
  const changed = Buffer.concat([
    prefix,
    changedHeader,
    original.subarray(12 + headerLength),
  ])
  const file = join(root, "oversized-raw.bin")
  await writeFile(file, changed)
  await expect(
    verifyGaCaptureFile(file, sha(changed), changed.length),
  ).rejects.toThrow(/aggregate raw size/i)
})
