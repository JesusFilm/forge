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
function dateRangeArtifact(
  availabilityOverrides: Record<string, unknown> = {},
) {
  const original = validArtifact()
  const headerLength = original.readUInt32BE(8)
  const header = JSON.parse(
    original.subarray(12, 12 + headerLength).toString("utf8"),
  )
  const availability = {
    coverage: "partial_source_history",
    requestedStart: "2022-06-21",
    requestedEnd: "2026-10-05",
    usableStart: "2022-08-11",
    usableEnd: "2026-10-05",
    truncationType: "DATA_TRUNCATION_TYPE_DATE_RANGE",
    dataTruncationDateRanges: [
      { startDate: "2022-06-21", endDate: "2022-08-10" },
    ],
    unavailablePrefixStart: "2022-06-21",
    unavailablePrefixEnd: "2022-08-10",
    observedFirstMonth: "202209",
    observedLastMonth: "202610",
    ...availabilityOverrides,
  }
  Object.assign(header, {
    requestedStart: availability.requestedStart,
    requestedEnd: availability.requestedEnd,
    usableStart: availability.usableStart,
    usableEnd: availability.usableEnd,
    sourceAvailability: availability,
  })
  header.baseQualification.sourceAvailability = availability
  header.baseQualificationDigest = sha(
    canonicalGaCaptureJson(header.baseQualification),
  )
  const changedHeader = Buffer.from(canonicalGaCaptureJson(header))
  const prefix = Buffer.alloc(12)
  prefix.write("FORGEGA1")
  prefix.writeUInt32BE(changedHeader.length, 8)
  return Buffer.concat([
    prefix,
    changedHeader,
    original.subarray(12 + headerLength),
  ])
}
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

it("verifies a bounded capture while preserving the inclusive GA date-range provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
  roots.push(root)
  const file = join(root, "date-range.bin")
  const bytes = dateRangeArtifact()
  await writeFile(file, bytes)
  const verified = await verifyGaCaptureFile(file, sha(bytes), bytes.length)
  expect(verified.header.sourceAvailability).toMatchObject({
    truncationType: "DATA_TRUNCATION_TYPE_DATE_RANGE",
    dataTruncationDateRanges: [
      { startDate: "2022-06-21", endDate: "2022-08-10" },
    ],
    usableStart: "2022-08-11",
  })
  expect(verified.header.sourceAvailability).not.toHaveProperty(
    "truncationDate",
  )
  expect(verified.header.baseQualification.sourceAvailability).toEqual(
    verified.header.sourceAvailability,
  )
})

it.each([
  {
    name: "nonprefix range",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-07-01", endDate: "2022-08-10" },
      ],
    },
  },
  {
    name: "range before requested start",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-20", endDate: "2022-08-10" },
      ],
    },
  },
  { name: "null ranges", overrides: { dataTruncationDateRanges: null } },
  { name: "empty ranges", overrides: { dataTruncationDateRanges: [] } },
  {
    name: "two adjacent ranges",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2022-07-31" },
        { startDate: "2022-08-01", endDate: "2022-08-10" },
      ],
    },
  },
  {
    name: "internal gap",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2022-07-01" },
        { startDate: "2022-08-01", endDate: "2022-08-10" },
      ],
    },
  },
  {
    name: "reversed range",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2022-06-20" },
      ],
      unavailablePrefixEnd: "2022-06-20",
      usableStart: "2022-06-21",
    },
  },
  {
    name: "no usable suffix",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2026-10-05" },
      ],
      unavailablePrefixEnd: "2026-10-05",
      usableStart: "2026-10-06",
    },
  },
  {
    name: "range end differs from prefix",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2022-08-09" },
      ],
    },
  },
  {
    name: "claimed prefix differs from request",
    overrides: { unavailablePrefixStart: "2022-06-20" },
  },
  {
    name: "inclusive end reused as usable start",
    overrides: { usableStart: "2022-08-10" },
  },
  {
    name: "extra unproven day omitted",
    overrides: { usableStart: "2022-08-12" },
  },
  {
    name: "usable end differs from request",
    overrides: { usableEnd: "2026-10-04" },
  },
  {
    name: "fabricated scalar date",
    overrides: { truncationDate: "2022-08-10" },
  },
  {
    name: "invalid calendar date",
    overrides: {
      dataTruncationDateRanges: [
        { startDate: "2022-06-21", endDate: "2022-02-30" },
      ],
    },
  },
])(
  "rejects a self-hashed date-range capture with $name",
  async ({ overrides }) => {
    const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-"))
    roots.push(root)
    const file = join(root, "nonprefix.bin")
    const bytes = dateRangeArtifact(overrides)
    await writeFile(file, bytes)
    await expect(
      verifyGaCaptureFile(file, sha(bytes), bytes.length),
    ).rejects.toMatchObject({ name: "ZodError" })
  },
)

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
