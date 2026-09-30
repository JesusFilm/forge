import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { env } from "../config/env"
import {
  freezeLegacyDetailRetirement,
  runLegacyDetailRetirement,
  type LegacyDetailRetirementManifest,
} from "../services/recommendations/legacy-detail-retirement.service"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"
import { assertOriginalQualityHolds } from "../services/recommendations/legacy-quality-holds"
import { RecommendationInputError } from "../services/recommendations/errors"

const Hash = z.string().regex(/^[a-f0-9]{64}$/)
const Revision = z.string().regex(/^[a-f0-9]{40}$/)
const RunId = z.string().min(1).max(191)
const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
] as const
const Holds = z.object({
  qualitySelectorSha256: Hash,
  qualityRunIds: z.array(RunId).length(64),
  activeInvestigationRunIds: z.array(RunId).max(10_000),
})
const HoldsEnvelope = z.object({
  reviewedAt: z.iso.datetime(),
  sourceReceiptSha256: Hash,
  holds: Holds,
})
const Capacity = z.object({
  measuredAt: z.iso.datetime(),
  targetDatabaseHash: Hash,
  filesystemAvailableBytes: z.number().int().nonnegative(),
  walBytes: z.number().int().nonnegative(),
  httpHealthy: z.literal(true),
  workerHealthy: z.literal(true),
  compactWritersConverged: z.literal(true),
  retentionHealthy: z.literal(true),
})
const Row = z.object({
  runId: RunId,
  declaredStageRows: z.number().int().min(0).max(448),
  stageRows: z.number().int().min(0).max(448),
  expiresAt: z.iso.datetime(),
  baseline: z.record(z.string(), z.unknown()),
  baselineSha256: Hash,
})
const Wave = z.object({
  index: z.number().int().nonnegative(),
  plannedEnd: z.iso.datetime(),
  batches: z.array(z.array(Row).min(1).max(10)).min(1).max(10),
})
const SourceHashes = z.record(z.string(), Hash)
const SourceReview = z.object({
  originalRevision: Revision,
  currentRevision: Revision,
  sourceHashes: SourceHashes,
  reviewedAt: z.iso.datetime(),
  reviewReceiptSha256: Hash,
})
const ArchiveReceipt = z.object({
  waveDigest: Hash,
  manifestSetSha256: Hash,
  count: z.number().int().min(1).max(10),
  fileSha256: z.array(
    z.object({ index: z.number().int().nonnegative(), sha256: Hash }),
  ),
})
const ArchiveAck = z.object({
  kind: z.literal("durable-private-ack"),
  waveDigest: Hash,
  manifestSetSha256: Hash,
  archivedAt: z.iso.datetime(),
  archiveReceipt: ArchiveReceipt,
  archiveReceiptSha256: Hash,
})
const Input = z.object({
  masterDigest: Hash,
  masterHeader: z.object({
    digest: Hash,
    targetDatabaseHash: Hash,
    createdBefore: z.iso.datetime(),
    originalRevision: Revision,
    sourceHashes: SourceHashes,
    selectionReceiptSha256: Hash,
  }),
  waveIndex: z.number().int().nonnegative(),
  waveDigest: Hash,
  wave: Wave,
  expectedRevision: Revision,
  sourceHashes: SourceHashes,
  entrypointSha256: Hash,
  sourceReview: SourceReview.optional(),
  holdsEnvelope: HoldsEnvelope,
  capacity: Capacity,
  manifests: z.array(z.unknown()).optional(),
  ack: ArchiveAck.optional(),
})
export type WaveInput = z.infer<typeof Input>
type Database = Pick<PrismaClient, "$queryRaw" | "$transaction">
type Services = {
  freeze: typeof freezeLegacyDetailRetirement
  run: typeof runLegacyDetailRetirement
  target: typeof conversionDatabaseHash
}
const services: Services = {
  freeze: freezeLegacyDetailRetirement,
  run: runLegacyDetailRetirement,
  target: conversionDatabaseHash,
}

function reject(reason: string): never {
  throw new RecommendationInputError(reason)
}
function hash(value: unknown): string {
  return createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex")
}
function fresh(when: string, now: number): boolean {
  const age = now - Date.parse(when)
  return Number.isFinite(age) && age >= 0 && age <= 120_000
}
function sameInstant(a: unknown, b: unknown): boolean {
  const left = a instanceof Date ? a.getTime() : Date.parse(String(a))
  const right = b instanceof Date ? b.getTime() : Date.parse(String(b))
  return Number.isFinite(left) && left === right
}
function sameSourceHashes(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  return (
    Object.keys(a).length === sourceFiles.length &&
    Object.keys(b).length === sourceFiles.length &&
    sourceFiles.every(
      (file) => a[file] === b[file] && a[file] === hash(readFileSync(file)),
    )
  )
}

/** A small primitive: the local operator separately proves master membership. */
export function validateWaveInput(value: unknown, now = Date.now()): WaveInput {
  // Zod rebuilds objects in schema-key order. The operator signs the original
  // JSON field order, so validate with Zod but retain the exact wire object.
  Input.parse(value)
  const input = value as WaveInput
  const { masterHeader: master, wave } = input
  if (
    input.masterDigest !== master.digest ||
    input.waveDigest !== hash(wave) ||
    input.waveIndex !== wave.index ||
    Date.parse(master.createdBefore) > now ||
    Date.parse(wave.plannedEnd) <= now ||
    Date.parse(wave.plannedEnd) - now >= 15 * 60_000 ||
    !sameSourceHashes(input.sourceHashes, master.sourceHashes) ||
    hash(readFileSync(fileURLToPath(import.meta.url))) !==
      input.entrypointSha256 ||
    env.DD_VERSION !== input.expectedRevision
  )
    reject("Wave scope, source or deadline changed")
  if (
    input.expectedRevision !== master.originalRevision ||
    input.sourceReview
  ) {
    const review = input.sourceReview
    if (
      !review ||
      review.originalRevision !== master.originalRevision ||
      review.currentRevision !== input.expectedRevision ||
      !fresh(review.reviewedAt, now) ||
      !sameSourceHashes(review.sourceHashes, master.sourceHashes)
    )
      reject("Deployed source review is missing or stale")
  }
  const seen = new Set<string>()
  for (const batch of wave.batches) {
    let rows = 0
    for (const [index, row] of batch.entries()) {
      const baseline = row.baseline
      if (
        seen.has(row.runId) ||
        (index > 0 && row.runId <= batch[index - 1]!.runId) ||
        row.stageRows !== row.declaredStageRows ||
        Date.parse(row.expiresAt) <= Date.parse(wave.plannedEnd) + 300_000 ||
        baseline.id !== row.runId ||
        baseline.stage_count !== row.stageRows ||
        baseline.declared_stage_count !== row.declaredStageRows ||
        baseline.trace_format_version !== null ||
        baseline.legacy_detail_retired_at !== null ||
        !sameInstant(baseline.expires_at, row.expiresAt) ||
        !Number.isFinite(Date.parse(String(baseline.root_expires_at))) ||
        Date.parse(String(baseline.root_expires_at)) <=
          Date.parse(wave.plannedEnd) + 300_000 ||
        hash(baseline) !== row.baselineSha256
      )
        reject("Wave roster, baseline or expiry changed")
      seen.add(row.runId)
      rows += row.stageRows
    }
    if (rows > 4_000) reject("Wave batch row budget exceeded")
  }
  return input
}

function validateCurrentGates(
  input: WaveInput,
  current: WaveInput,
  now = Date.now(),
): void {
  if (
    hash(current.wave) !== input.waveDigest ||
    current.masterDigest !== input.masterDigest ||
    current.expectedRevision !== input.expectedRevision ||
    current.entrypointSha256 !== input.entrypointSha256 ||
    JSON.stringify(current.sourceReview) !==
      JSON.stringify(input.sourceReview) ||
    (current.sourceReview !== undefined &&
      !fresh(current.sourceReview.reviewedAt, now)) ||
    JSON.stringify(current.manifests) !== JSON.stringify(input.manifests) ||
    JSON.stringify(current.ack) !== JSON.stringify(input.ack) ||
    !sameSourceHashes(current.sourceHashes, input.sourceHashes) ||
    env.DD_VERSION !== input.expectedRevision ||
    hash(readFileSync(fileURLToPath(import.meta.url))) !==
      input.entrypointSha256 ||
    now >= Date.parse(input.wave.plannedEnd)
  )
    reject("Current wave, source or deadline changed")
  const original = input.holdsEnvelope
  const holds = current.holdsEnvelope
  if (
    !fresh(holds.reviewedAt, now) ||
    holds.sourceReceiptSha256 !== original.sourceReceiptSha256 ||
    JSON.stringify(holds.holds) !== JSON.stringify(original.holds)
  )
    reject("Current protection review changed or is stale")
  assertOriginalQualityHolds(holds.holds)
  const capacity = current.capacity
  if (
    !fresh(capacity.measuredAt, now) ||
    capacity.targetDatabaseHash !== input.masterHeader.targetDatabaseHash ||
    capacity.filesystemAvailableBytes < 8_000_000_000 ||
    capacity.walBytes > 2_000_000_000 ||
    !capacity.httpHealthy ||
    !capacity.workerHealthy ||
    !capacity.compactWritersConverged ||
    !capacity.retentionHealthy
  )
    reject("Current fleet or capacity review failed")
}

function counts(manifest: LegacyDetailRetirementManifest) {
  return {
    converted: manifest.candidates.filter(
      (candidate) => candidate.action !== "retire",
    ).length,
    retired: manifest.candidates.filter(
      (candidate) => candidate.action === "retire",
    ).length,
    rows: manifest.candidates.reduce(
      (sum, candidate) => sum + candidate.rows,
      0,
    ),
    bytes: manifest.candidates.reduce(
      (sum, candidate) => sum + candidate.bytes,
      0,
    ),
  }
}
function validateManifest(
  manifest: LegacyDetailRetirementManifest,
  input: WaveInput,
  batchIndex: number,
  now = Date.now(),
): void {
  const expected = input.wave.batches[batchIndex]!
  const { digest, ...body } = manifest
  const age = now - Date.parse(manifest.frozenAt)
  if (
    manifest.version !== 2 ||
    digest !== hash(body) ||
    manifest.targetDatabaseHash !== input.masterHeader.targetDatabaseHash ||
    manifest.createdBefore !== input.masterHeader.createdBefore ||
    !Number.isFinite(age) ||
    age < 0 ||
    age >= 15 * 60_000 ||
    JSON.stringify(manifest.holds) !==
      JSON.stringify(input.holdsEnvelope.holds) ||
    manifest.candidates.length !== expected.length ||
    manifest.candidates.some(
      (candidate, index) =>
        candidate.runId !== expected[index]!.runId ||
        candidate.rows !== expected[index]!.stageRows ||
        !["retire", "convert", "preserve"].includes(candidate.action),
    )
  )
    reject("Frozen manifest differs from reviewed wave")
}
function validateArchive(
  input: WaveInput,
  manifests: LegacyDetailRetirementManifest[],
  now = Date.now(),
) {
  const ack = input.ack
  const ackAge = ack ? now - Date.parse(ack.archivedAt) : Number.NaN
  if (
    !ack ||
    manifests.length !== input.wave.batches.length ||
    ack.waveDigest !== input.waveDigest ||
    !Number.isFinite(ackAge) ||
    ackAge < 0 ||
    ackAge >= 15 * 60_000 ||
    ack.archiveReceiptSha256 !== hash(ack.archiveReceipt) ||
    ack.archiveReceipt.waveDigest !== input.waveDigest ||
    ack.archiveReceipt.count !== manifests.length ||
    ack.archiveReceipt.fileSha256.length !== manifests.length
  )
    reject("Durable private archive acknowledgement is absent or stale")
  const set = hash(
    manifests.map((manifest, index) => ({ index, digest: manifest.digest })),
  )
  if (
    ack.manifestSetSha256 !== set ||
    ack.archiveReceipt.manifestSetSha256 !== set ||
    ack.archiveReceipt.fileSha256.some(
      (file, index) =>
        file.index !== index ||
        file.sha256 !== hash(Buffer.from(JSON.stringify(manifests[index]))),
    )
  )
    reject("Durable private archive differs from manifests")
  manifests.forEach((manifest, index) =>
    validateManifest(manifest, input, index, now),
  )
}
function writePrivate(directory: string, name: string, value: unknown): void {
  const fd = openSync(join(directory, name), "wx", 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n")
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const dir = openSync(directory, "r")
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}

export async function freezeRetirementWave(
  db: Database,
  input: WaveInput,
  directory: string,
  readCurrent: () => WaveInput,
  api: Services = services,
  emit: (receipt: object) => void = () => {},
): Promise<void> {
  const started = Date.now()
  if ((await api.target(db)) !== input.masterHeader.targetDatabaseHash)
    reject("Target database differs from reviewed wave")
  for (const [index, batch] of input.wave.batches.entries()) {
    validateCurrentGates(input, readCurrent())
    const batchStarted = Date.now()
    const manifest = await api.freeze(db, {
      runIds: batch.map((row) => row.runId),
      createdBefore: input.masterHeader.createdBefore,
      holds: input.holdsEnvelope.holds,
    })
    validateManifest(manifest, input, index)
    writePrivate(
      directory,
      `manifest-${String(index).padStart(2, "0")}.json`,
      manifest,
    )
    emit({
      status: "frozen-batch-private",
      waveIndex: input.waveIndex,
      batchIndex: index,
      elapsedMs: Date.now() - batchStarted,
    })
  }
  emit({
    status: "frozen-awaiting-local-ack",
    waveIndex: input.waveIndex,
    waveDigest: input.waveDigest,
    manifests: input.wave.batches.length,
    elapsedMs: Date.now() - started,
    databaseWrites: 0,
  })
}

export async function executeRetirementWave(
  db: Database,
  input: WaveInput,
  readCurrent: () => WaveInput,
  api: Services = services,
  emit: (receipt: object) => void = () => {},
): Promise<void> {
  const started = Date.now()
  if ((await api.target(db)) !== input.masterHeader.targetDatabaseHash)
    reject("Target database differs from reviewed wave")
  const manifests = input.manifests as
    | LegacyDetailRetirementManifest[]
    | undefined
  if (!manifests) reject("Complete backed manifest set is required")
  validateArchive(input, manifests)
  for (const manifest of manifests) {
    validateCurrentGates(input, readCurrent())
    const dry = await api.run(db, manifest, { execute: false })
    const expected = counts(manifest)
    if (
      dry.status !== "dry-run" ||
      dry.converted !== 0 ||
      dry.retired !== 0 ||
      dry.rows !== expected.rows ||
      dry.bytes !== expected.bytes
    )
      reject("Dry-run differs from frozen manifest")
  }
  let converted = 0,
    retired = 0,
    rows = 0,
    bytes = 0
  for (const [index, manifest] of manifests.entries()) {
    validateCurrentGates(input, readCurrent())
    validateArchive(input, manifests)
    const batchStarted = Date.now()
    const result = await api.run(db, manifest, {
      execute: true,
      confirmTarget: input.masterHeader.targetDatabaseHash,
    })
    const expected = counts(manifest)
    if (
      result.status !== "completed" ||
      result.converted !== expected.converted ||
      result.retired !== expected.retired ||
      result.rows !== expected.rows ||
      result.bytes !== expected.bytes
    )
      reject("Execution receipt differs from frozen manifest")
    converted += expected.converted
    retired += expected.retired
    rows += expected.rows
    bytes += expected.bytes
    emit({
      status: "batch-receipted-unverified",
      waveIndex: input.waveIndex,
      batchIndex: index,
      completedBatches: index + 1,
      converted,
      retired,
      rows,
      bytes,
      elapsedMs: Date.now() - batchStarted,
    })
  }
  emit({
    status: "wave-cli-completed-requires-readonly-reconcile",
    waveIndex: input.waveIndex,
    waveDigest: input.waveDigest,
    completedBatches: manifests.length,
    converted,
    retired,
    rows,
    bytes,
    elapsedMs: Date.now() - started,
  })
}

export function parseWaveArguments(argv: string[]) {
  const flags = argv.filter(
    (arg) => arg === "--freeze-wave" || arg === "--execute-wave",
  )
  if (flags.length !== 1) reject("Choose exactly one wave phase")
  const pairs = argv.filter(
    (arg) => arg !== "--freeze-wave" && arg !== "--execute-wave",
  )
  if (pairs.length % 2 !== 0) reject("Incomplete wave argument")
  const values = new Map<string, string>()
  for (let index = 0; index < pairs.length; index += 2) {
    const key = pairs[index]!
    const value = pairs[index + 1]!
    if (
      !["--input", "--manifest-dir", "--confirm-target"].includes(key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--")
    )
      reject("Unknown or duplicate wave argument")
    values.set(key, value)
  }
  if (
    !values.has("--input") ||
    (flags[0] === "--freeze-wave" &&
      (!values.has("--manifest-dir") || values.has("--confirm-target"))) ||
    (flags[0] === "--execute-wave" &&
      (!values.has("--confirm-target") || values.has("--manifest-dir")))
  )
    reject("Wave phase arguments are incomplete")
  return { phase: flags[0], values }
}

async function main(): Promise<void> {
  const { phase, values } = parseWaveArguments(process.argv.slice(2))
  const inputFile = values.get("--input")!
  const readCurrent = () =>
    validateWaveInput(JSON.parse(readFileSync(inputFile, "utf8")))
  const input = readCurrent()
  if (
    phase === "--execute-wave" &&
    values.get("--confirm-target") !== input.masterHeader.targetDatabaseHash
  )
    reject("Explicit target confirmation differs from wave")
  const { createPrismaClient } = await import("../db/client")
  const db = createPrismaClient("main")
  const emit = (receipt: object) => console.log(JSON.stringify(receipt))
  try {
    if (phase === "--freeze-wave") {
      const directory = values.get("--manifest-dir")!
      if (!existsSync(directory) || (statSync(directory).mode & 0o077) !== 0)
        reject("Private manifest directory is absent or exposed")
      await freezeRetirementWave(
        db,
        input,
        directory,
        readCurrent,
        services,
        emit,
      )
    } else {
      await executeRetirementWave(db, input, readCurrent, services, emit)
    }
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Legacy wave stopped; reconcile backed manifests before any new attempt.",
    )
    process.exitCode = 1
  })
