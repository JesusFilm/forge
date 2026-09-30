/**
 * One bounded, root-operated legacy-detail session. The existing v2 wave CLI
 * remains unchanged. Every write still uses runLegacyDetailRetirement's
 * ten-run transaction, row/byte limits, locks, and SQL fingerprints.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { env } from "../config/env"
import { createPrismaClient } from "../db/client"
import {
  freezeLegacyDetailRetirement,
  hasCompletedLegacyDetailRetirementReceipt,
  runLegacyDetailRetirement,
  type LegacyDetailRetirementManifest,
} from "../services/recommendations/legacy-detail-retirement.service"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"
import { assertOriginalQualityHolds } from "../services/recommendations/legacy-quality-holds"

const MASTER_DIGEST =
  "fff0103d6966b69fa913fd61eecc0c05c2e10009c4b6206b32fd2000a8fc3d34"
const QUALITY_SELECTOR =
  "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1"
// This first speed pilot must finish before the next ordinary expiry purge.
const RETENTION_BOUNDARY = Date.parse("2026-09-30T10:25:00.000Z")
const SOURCE_FILES = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
  "src/scripts/retire-legacy-recommendation-detail-session.ts",
] as const
const Hash = z.string().regex(/^[a-f0-9]{64}$/)
const Revision = z.string().regex(/^[a-f0-9]{40}$/)
const Iso = z.iso.datetime()
const RunId = z.string().min(1).max(191)
const Row = z.object({
  runId: RunId,
  declaredStageRows: z.number().int().min(0).max(448),
  expiresAt: Iso,
})
const Wave = z.object({
  index: z.number().int().nonnegative(),
  plannedEnd: Iso,
  batches: z.array(z.array(Row).length(10)).length(10),
})
const Cohort = z.object({
  version: z.literal(1),
  masterDigest: Hash,
  createdBefore: Iso,
  selectionReceiptSha256: Hash,
  waves: z.array(Wave).length(10),
  digest: Hash,
})
const Holds = z.object({
  qualitySelectorSha256: Hash,
  qualityRunIds: z.array(RunId).length(64),
  activeInvestigationRunIds: z.array(RunId).max(10_000),
})
const Lease = z.object({
  reviewedAt: Iso,
  expiresAt: Iso,
  canonicalRegistrySha256: Hash,
  reviewReceiptSha256: Hash,
  holds: Holds,
})
const Source = z.object({
  revision: Revision,
  targetDatabaseHash: Hash,
  sourceHashes: z.record(z.string(), Hash),
  reviewedAt: Iso,
  reviewReceiptSha256: Hash,
})
const Permit = z.object({
  measuredAt: Iso,
  targetDatabaseHash: Hash,
  revision: Revision,
  registrySha256: Hash,
  receiptSha256: Hash,
  filesystemAvailableBytes: z.number().int().nonnegative(),
  walBytes: z.number().int().nonnegative(),
  httpHealthy: z.literal(true),
  workerHealthy: z.literal(true),
  compactWritersConverged: z.literal(true),
  retentionHealthy: z.literal(true),
  serving: z.object({
    lastRequestAt: Iso,
    requests: z.number().int().positive(),
    latencySamples: z.number().int().positive(),
    p95Ms: z.number().finite().nonnegative(),
    maxMs: z.number().finite().nonnegative(),
    unexpectedResultCount: z.literal(0),
  }),
  locks: z.object({
    waiters: z.literal(0),
    targetSessions: z.literal(0),
    assignedWriteXidSessions: z.literal(0),
  }),
})
type CohortInput = z.infer<typeof Cohort>
type LeaseInput = z.infer<typeof Lease>
type SourceInput = z.infer<typeof Source>
type PermitInput = z.infer<typeof Permit>
type BaselineRow = Record<string, unknown> & {
  id: string
  request_id: string
  root_digest: string
  run_digest: string
  items_digest: string
  stages_digest: string
  stage_count: number
  trace_format_version: number | null
  legacy_detail_retired_at: string | null
  expires_at: string
  root_expires_at: string
  declared_stage_count: number
  evidence_complete: boolean
  composed_count: number
  compact_payload_digest: string | null
  compact_count: number
  compact_digest: string | null
}

// Same typed/decoded parity query as the reviewed finite operator. Each call
// is limited to ten candidates or the original 64 protected holdouts.
const BASELINE_QUERY = `SELECT c.id,c.request_id,
  md5(to_jsonb(r)::text) AS root_digest,
  md5((to_jsonb(c)-'trace_format_version'-'trace_payload'-'legacy_detail_retired_at')::text) AS run_digest,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb)::text) FROM recommendation_served_item i WHERE i.request_id=r.id) AS items_digest,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.stage,e.ordinal),'[]'::jsonb)::text) FROM recommendation_candidate_stage_evidence e WHERE e.run_id=c.id) AS stages_digest,
  (SELECT count(*)::int FROM recommendation_candidate_stage_evidence e WHERE e.run_id=c.id) AS stage_count,
  c.trace_format_version,c.legacy_detail_retired_at,c.expires_at,r.expires_at AS root_expires_at,c.evidence_complete,c.composed_count,
  (c.nominated_count+c.canonicalized_count+c.deduplicated_count+c.rejected_count+c.scored_count+c.ordered_count+c.composed_count)::int AS declared_stage_count,
  md5(c.trace_payload::text) AS compact_payload_digest,
  CASE WHEN c.trace_format_version=1 THEN jsonb_array_length(c.trace_payload->'stages') ELSE 0 END AS compact_count,
  CASE WHEN c.trace_format_version=1 THEN (SELECT md5(coalesce(jsonb_agg(to_jsonb(decoded) ORDER BY decoded.stage,decoded.ordinal),'[]'::jsonb)::text) FROM (
    SELECT (jsonb_populate_record(NULL::recommendation_candidate_stage_evidence,jsonb_build_object(
      'id',v->'id','run_id',c.id,'stage',v->'stage','ordinal',v->'ordinal','candidate_key',v->'candidateKey','target_media_id',v->'targetMediaId',
      'source_generator',v->'sourceGenerator','source_rank',v->'sourceRank','source_score',v->'sourceScore','normalized_score',v->'normalizedScore',
      'rrf_score',v->'rrfScore','deterministic_score',v->'deterministicScore','final_position',v->'finalPosition','reason_codes',v->'reasonCodes',
      'source_evidence',v->'sourceEvidence','created_at',v->'createdAt','expires_at',c.expires_at))).*
    FROM jsonb_array_elements(c.trace_payload->'stages') v) decoded) ELSE NULL END AS compact_digest
  FROM recommendation_candidate_run c JOIN recommendation_request r ON r.id=c.request_id
  WHERE c.id=ANY($1::text[]) ORDER BY c.id`

const sha = (value: string | Buffer | object): string =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex")
const ms = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Date.parse(String(value))
const sameInstant = (a: unknown, b: unknown): boolean =>
  Number.isFinite(ms(a)) && ms(a) === ms(b)
function guard(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason)
}
function fresh(value: string, maximumMs: number, now = Date.now()): boolean {
  const age = now - ms(value)
  return Number.isFinite(age) && age >= 0 && age <= maximumMs
}
function assertSource(source: SourceInput): void {
  guard(env.DD_VERSION === source.revision, "revision")
  guard(
    Object.keys(source.sourceHashes).length === SOURCE_FILES.length &&
      SOURCE_FILES.every(
        (file) => sha(readFileSync(file)) === source.sourceHashes[file],
      ),
    "source",
  )
}
function assertLease(lease: LeaseInput, now = Date.now()): void {
  guard(
    ms(lease.expiresAt) === ms(lease.reviewedAt) + 30 * 60_000 &&
      now >= ms(lease.reviewedAt) &&
      now < ms(lease.expiresAt) &&
      lease.holds.qualitySelectorSha256 === QUALITY_SELECTOR &&
      new Set(lease.holds.qualityRunIds).size === 64 &&
      new Set(lease.holds.activeInvestigationRunIds).size ===
        lease.holds.activeInvestigationRunIds.length,
    "lease",
  )
  assertOriginalQualityHolds(lease.holds)
}
function assertCohort(cohort: CohortInput, stopBefore: string): void {
  const { digest, ...body } = cohort
  guard(
    cohort.masterDigest === MASTER_DIGEST &&
      digest === sha(body) &&
      ms(cohort.createdBefore) <= Date.now() &&
      ms(stopBefore) <= RETENTION_BOUNDARY &&
      ms(stopBefore) > Date.now() &&
      cohort.waves.every(
        (wave, index) =>
          wave.index > 13 &&
          (index === 0 || wave.index > cohort.waves[index - 1]!.index) &&
          ms(wave.plannedEnd) > Date.now() &&
          ms(wave.plannedEnd) <= ms(stopBefore),
      ),
    "cohort",
  )
  const seen = new Set<string>()
  for (const wave of cohort.waves)
    for (const batch of wave.batches) {
      let rows = 0
      for (const [index, row] of batch.entries()) {
        guard(
          !seen.has(row.runId) &&
            (index === 0 || row.runId > batch[index - 1]!.runId) &&
            ms(row.expiresAt) > ms(wave.plannedEnd) + 300_000,
          "cohort-roster",
        )
        seen.add(row.runId)
        rows += row.declaredStageRows
      }
      guard(rows <= 4_000, "row-budget")
    }
  guard(seen.size === 1_000, "cohort-size")
}

function assertPermit(
  permit: PermitInput,
  source: SourceInput,
  lease: LeaseInput,
  stopBefore: string,
): void {
  const now = Date.now()
  assertSource(source)
  assertLease(lease, now)
  guard(now < ms(stopBefore), "retention-boundary")
  guard(
    fresh(permit.measuredAt, 90_000, now) &&
      fresh(permit.serving.lastRequestAt, 120_000, now) &&
      permit.targetDatabaseHash === source.targetDatabaseHash &&
      permit.revision === source.revision &&
      permit.registrySha256 === lease.canonicalRegistrySha256 &&
      permit.filesystemAvailableBytes >= 8_000_000_000 &&
      permit.walBytes <= 2_000_000_000 &&
      permit.serving.p95Ms <= 600 &&
      permit.serving.maxMs <= 1_500,
    "permit",
  )
}

function assertExecutionHeadroom(
  wave: z.infer<typeof Wave>,
  lease: LeaseInput,
  stopBefore: string,
): void {
  // The v2 writer can spend 30 seconds in its bounded transaction. Do not
  // begin a write that could commit after any reviewed safety deadline.
  guard(
    Date.now() + 40_000 <
      Math.min(
        ms(wave.plannedEnd),
        ms(lease.expiresAt),
        ms(stopBefore),
        RETENTION_BOUNDARY,
      ),
    "execution-deadline",
  )
}

function assertOriginalQuality(
  original: BaselineRow[],
  current: BaselineRow[],
  lease: LeaseInput,
): void {
  guard(original.length === 64 && current.length === 64, "quality-count")
  const byId = new Map(current.map((row) => [row.id, row]))
  guard(byId.size === 64, "quality-membership")
  guard(
    JSON.stringify(original.map((row) => row.id).sort()) ===
      JSON.stringify([...lease.holds.qualityRunIds].sort()),
    "quality-selector",
  )
  let observations = 0
  for (const old of original) {
    const row = byId.get(old.id)
    guard(
      row &&
        row.request_id === old.request_id &&
        row.root_digest === old.root_digest &&
        row.run_digest === old.run_digest &&
        row.items_digest === old.items_digest &&
        sameInstant(row.expires_at, old.expires_at) &&
        sameInstant(row.root_expires_at, old.root_expires_at) &&
        row.declared_stage_count === old.declared_stage_count &&
        row.evidence_complete === old.evidence_complete &&
        row.composed_count === old.composed_count,
      "quality-parent",
    )
    const oldCount = old.stage_count + old.compact_count
    const oldDigest =
      old.trace_format_version === 1 ? old.compact_digest : old.stages_digest
    const legacy =
      old.trace_format_version === null &&
      row.trace_format_version === null &&
      row.legacy_detail_retired_at === null &&
      row.stage_count === old.stage_count &&
      row.stages_digest === old.stages_digest &&
      row.compact_count === 0
    const compact =
      row.trace_format_version === 1 &&
      row.legacy_detail_retired_at === null &&
      row.stage_count === 0 &&
      row.compact_count === oldCount &&
      row.compact_digest === oldDigest
    guard(legacy || compact, "quality-observations")
    observations += row.stage_count + row.compact_count
  }
  guard(observations === 8_621, "quality-total")
}

function assertAfter(
  old: BaselineRow,
  current: BaselineRow | undefined,
  action: "retire" | "convert" | "preserve",
): void {
  guard(
    current &&
      current.request_id === old.request_id &&
      current.root_digest === old.root_digest &&
      current.run_digest === old.run_digest &&
      current.items_digest === old.items_digest &&
      sameInstant(current.expires_at, old.expires_at) &&
      sameInstant(current.root_expires_at, old.root_expires_at) &&
      current.stage_count === 0 &&
      current.declared_stage_count === old.declared_stage_count &&
      current.evidence_complete === old.evidence_complete &&
      current.composed_count === old.composed_count,
    "after-parent",
  )
  if (action === "retire")
    guard(
      current.trace_format_version === null &&
        current.legacy_detail_retired_at !== null &&
        current.compact_payload_digest === null &&
        current.compact_count === 0,
      "after-retire",
    )
  else
    guard(
      current.trace_format_version === 1 &&
        current.legacy_detail_retired_at === null &&
        current.compact_count === old.stage_count &&
        current.compact_digest === old.stages_digest,
      "after-convert",
    )
}

type SessionStart = {
  kind: "start"
  seq: 0
  cohort: CohortInput
  source: SourceInput
  lease: LeaseInput
  qualityBaseline: BaselineRow[]
  stopBefore: string
}
type FrozenBatch = {
  manifest: LegacyDetailRetirementManifest
  baseline: BaselineRow[]
  privateSha256: string
  verified: boolean
}

function parseStart(value: unknown): SessionStart {
  z.object({
    kind: z.literal("start"),
    seq: z.literal(0),
    cohort: Cohort,
    source: Source,
    lease: Lease,
    qualityBaseline: z.array(z.record(z.string(), z.unknown())).length(64),
    stopBefore: Iso,
  }).parse(value)
  // Preserve the received field order for its digest, as in the v2 wave CLI.
  return value as SessionStart
}

function parsePermit(value: unknown): PermitInput {
  return Permit.parse(value)
}

async function readOnly<T>(
  db: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1s'")
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10s'")
      await tx.$executeRawUnsafe(
        "SET LOCAL idle_in_transaction_session_timeout='15s'",
      )
      return operation(tx)
    },
    { timeout: 30_000 },
  )
}

async function rows(
  db: PrismaClient,
  runIds: string[],
): Promise<BaselineRow[]> {
  guard(runIds.length >= 1 && runIds.length <= 100, "read-scope")
  return readOnly(db, async (tx) => {
    const result = await tx.$queryRawUnsafe<BaselineRow[]>(
      BASELINE_QUERY,
      runIds,
    )
    const normalized = JSON.parse(JSON.stringify(result)) as BaselineRow[]
    guard(
      normalized.length === runIds.length &&
        JSON.stringify(normalized.map((row) => row.id).sort()) ===
          JSON.stringify([...runIds].sort()),
      "read-membership",
    )
    return normalized
  })
}

export const readLegacySessionBaseline = rows

async function actualDatabaseGate(
  db: PrismaClient,
  source: SourceInput,
): Promise<void> {
  assertSource(source)
  await readOnly(db, async (tx) => {
    guard(
      (await conversionDatabaseHash(tx)) === source.targetDatabaseHash,
      "target",
    )
    const [state] = await tx.$queryRawUnsafe<
      Array<{ wal_bytes: string; lock_waiters: number }>
    >(`SELECT (SELECT coalesce(sum(size),0)::text FROM pg_ls_waldir()) AS wal_bytes,
      (SELECT count(*)::int FROM pg_stat_activity
       WHERE datname=current_database() AND pid<>pg_backend_pid()
         AND wait_event_type='Lock') AS lock_waiters`)
    guard(
      state &&
        /^\d+$/.test(state.wal_bytes) &&
        Number.isSafeInteger(Number(state.wal_bytes)) &&
        Number(state.wal_bytes) <= 2_000_000_000 &&
        state.lock_waiters === 0,
      "database-capacity",
    )
  })
}

function assertBatchBaseline(
  batch: z.infer<typeof Row>[],
  baseline: BaselineRow[],
  plannedEnd: string,
): void {
  const byId = new Map(baseline.map((row) => [row.id, row]))
  guard(byId.size === 10, "batch-membership")
  for (const item of batch) {
    const row = byId.get(item.runId)
    guard(
      row &&
        row.stage_count === item.declaredStageRows &&
        row.declared_stage_count === item.declaredStageRows &&
        row.trace_format_version === null &&
        row.legacy_detail_retired_at === null &&
        sameInstant(row.expires_at, item.expiresAt) &&
        ms(row.expires_at) > ms(plannedEnd) + 300_000 &&
        ms(row.root_expires_at) > ms(plannedEnd) + 300_000,
      "batch-baseline",
    )
  }
}

function manifestCounts(manifest: LegacyDetailRetirementManifest) {
  return {
    converted: manifest.candidates.filter((item) => item.action !== "retire")
      .length,
    retired: manifest.candidates.filter((item) => item.action === "retire")
      .length,
    rows: manifest.candidates.reduce((sum, item) => sum + item.rows, 0),
    bytes: manifest.candidates.reduce((sum, item) => sum + item.bytes, 0),
  }
}

function assertManifest(
  manifest: LegacyDetailRetirementManifest,
  batch: z.infer<typeof Row>[],
  lease: LeaseInput,
  source: SourceInput,
): void {
  const { digest, ...body } = manifest
  guard(
    manifest.version === 2 &&
      digest === sha(body) &&
      manifest.targetDatabaseHash === source.targetDatabaseHash &&
      JSON.stringify(manifest.holds) === JSON.stringify(lease.holds) &&
      manifest.candidates.length === 10 &&
      manifest.candidates.every(
        (item, index) =>
          item.runId === batch[index]!.runId &&
          item.rows === batch[index]!.declaredStageRows,
      ) &&
      manifestCounts(manifest).rows <= 4_000 &&
      manifestCounts(manifest).bytes <= 16 * 1024 * 1024,
    "manifest",
  )
}

function baseResponse(
  kind: string,
  seq: number,
  planDigest: string,
  waveIndex?: number,
  batchIndex?: number,
) {
  return {
    kind,
    seq,
    planDigest,
    ...(waveIndex === undefined ? {} : { waveIndex }),
    ...(batchIndex === undefined ? {} : { batchIndex }),
  }
}

export async function runLegacyDetailSession(
  db: PrismaClient,
  commands: AsyncIterable<string>,
  emit: (frame: object) => void,
  expectedCohortDigest: string,
  expectedTargetHash: string,
): Promise<void> {
  let start: SessionStart | undefined
  let expectedSeq = 0
  let wavePosition = 0
  let batchPosition = 0
  let expectedKind = "start"
  let frozen: FrozenBatch | undefined
  const completed: FrozenBatch[][] = Array.from({ length: 10 }, () => [])
  let lastWaveReceiptHash: string | undefined

  for await (const line of commands) {
    guard(Buffer.byteLength(line) <= 4 * 1024 * 1024, "frame-size")
    const command = JSON.parse(line) as Record<string, unknown>
    guard(
      command.seq === expectedSeq && command.kind === expectedKind,
      "sequence",
    )
    if (expectedKind === "start") {
      start = parseStart(command)
      assertCohort(start.cohort, start.stopBefore)
      guard(
        start.cohort.digest === expectedCohortDigest &&
          start.source.targetDatabaseHash === expectedTargetHash,
        "activation",
      )
      assertLease(start.lease)
      guard(fresh(start.source.reviewedAt, 120_000), "source-review")
      await actualDatabaseGate(db, start.source)
      const quality = await rows(db, start.lease.holds.qualityRunIds)
      assertOriginalQuality(start.qualityBaseline, quality, start.lease)
      emit({
        ...baseResponse("ready", expectedSeq, start.cohort.digest),
        qualityRuns: 64,
        qualityObservations: 8_621,
      })
      expectedKind = "freeze-batch"
    } else {
      guard(start, "start")
      guard(command.planDigest === start.cohort.digest, "plan-digest")
      const wave = start.cohort.waves[wavePosition]!
      const batch = wave.batches[batchPosition]!
      const common = baseResponse(
        "",
        expectedSeq,
        start.cohort.digest,
        wave.index,
        batchPosition,
      )
      guard(command.waveIndex === wave.index, "wave-index")
      if (expectedKind !== "verify-wave" && expectedKind !== "ack-wave")
        guard(command.batchIndex === batchPosition, "batch-index")
      if (expectedKind === "freeze-batch") {
        const permit = parsePermit(command.permit)
        assertPermit(permit, start.source, start.lease, start.stopBefore)
        guard(
          ms(wave.plannedEnd) > Date.now() &&
            ms(wave.plannedEnd) - Date.now() < 15 * 60_000,
          "wave-deadline",
        )
        await actualDatabaseGate(db, start.source)
        if (batchPosition === 0) {
          const quality = await rows(db, start.lease.holds.qualityRunIds)
          assertOriginalQuality(start.qualityBaseline, quality, start.lease)
        }
        const baseline = await rows(
          db,
          batch.map((item) => item.runId),
        )
        assertBatchBaseline(batch, baseline, wave.plannedEnd)
        const manifest = await freezeLegacyDetailRetirement(db, {
          runIds: batch.map((item) => item.runId),
          createdBefore: start.cohort.createdBefore,
          holds: start.lease.holds,
        })
        assertManifest(manifest, batch, start.lease, start.source)
        const payload = Buffer.from(JSON.stringify({ manifest, baseline }))
        frozen = {
          manifest,
          baseline,
          privateSha256: sha(payload),
          verified: false,
        }
        emit({
          ...common,
          kind: "frozen-private",
          base64: payload.toString("base64"),
          sha256: frozen.privateSha256,
          baselineSha256: sha(baseline),
          manifestDigest: manifest.digest,
        })
        expectedKind = "ack-manifest"
      } else if (expectedKind === "ack-manifest") {
        guard(
          frozen &&
            command.sha256 === frozen.privateSha256 &&
            command.manifestDigest === frozen.manifest.digest,
          "manifest-ack",
        )
        emit({
          ...common,
          kind: "frozen-acked",
          sha256: frozen.privateSha256,
          manifestDigest: frozen.manifest.digest,
        })
        expectedKind = "execute-batch"
      } else if (expectedKind === "execute-batch") {
        guard(frozen, "frozen")
        const permit = parsePermit(command.permit)
        assertPermit(permit, start.source, start.lease, start.stopBefore)
        guard(
          command.manifestDigest === frozen.manifest.digest &&
            Hash.safeParse(command.attemptSha256).success,
          "attempt",
        )
        await actualDatabaseGate(db, start.source)
        const current = await rows(
          db,
          batch.map((item) => item.runId),
        )
        guard(
          JSON.stringify(current) === JSON.stringify(frozen.baseline),
          "changed-baseline",
        )
        const dry = await runLegacyDetailRetirement(db, frozen.manifest)
        const expected = manifestCounts(frozen.manifest)
        guard(
          dry.status === "dry-run" &&
            dry.rows === expected.rows &&
            dry.bytes === expected.bytes,
          "dry-run",
        )
        assertPermit(permit, start.source, start.lease, start.stopBefore)
        await actualDatabaseGate(db, start.source)
        assertExecutionHeadroom(wave, start.lease, start.stopBefore)
        const receipt = await runLegacyDetailRetirement(db, frozen.manifest, {
          execute: true,
          confirmTarget: start.source.targetDatabaseHash,
        })
        guard(
          receipt.status === "completed" &&
            receipt.converted === expected.converted &&
            receipt.retired === expected.retired &&
            receipt.rows === expected.rows &&
            receipt.bytes === expected.bytes,
          "execution",
        )
        guard(
          await hasCompletedLegacyDetailRetirementReceipt(db, frozen.manifest),
          "ledger",
        )
        const after = await rows(
          db,
          batch.map((item) => item.runId),
        )
        const byId = new Map(after.map((row) => [row.id, row]))
        for (const item of frozen.manifest.candidates)
          assertAfter(
            frozen.baseline.find((row) => row.id === item.runId)!,
            byId.get(item.runId),
            item.action,
          )
        frozen.verified = true
        completed[wavePosition]!.push(frozen)
        emit({
          ...common,
          kind: "batch-verified",
          ...expected,
          manifestDigest: frozen.manifest.digest,
          attemptSha256: command.attemptSha256,
        })
        frozen = undefined
        if (batchPosition < 9) {
          batchPosition++
          expectedKind = "freeze-batch"
        } else expectedKind = "verify-wave"
      } else if (expectedKind === "verify-wave") {
        guard(completed[wavePosition]!.length === 10, "wave-incomplete")
        await actualDatabaseGate(db, start.source)
        const allIds = wave.batches.flat().map((item) => item.runId)
        const current = await rows(db, allIds)
        const byId = new Map(current.map((row) => [row.id, row]))
        let converted = 0,
          retired = 0,
          rowCount = 0,
          bytes = 0
        for (const record of completed[wavePosition]!) {
          guard(record.verified, "batch-unverified")
          guard(
            await hasCompletedLegacyDetailRetirementReceipt(
              db,
              record.manifest,
            ),
            "ledger",
          )
          const count = manifestCounts(record.manifest)
          converted += count.converted
          retired += count.retired
          rowCount += count.rows
          bytes += count.bytes
          for (const item of record.manifest.candidates)
            assertAfter(
              record.baseline.find((row) => row.id === item.runId)!,
              byId.get(item.runId),
              item.action,
            )
        }
        const quality = await rows(db, start.lease.holds.qualityRunIds)
        assertOriginalQuality(start.qualityBaseline, quality, start.lease)
        const body = {
          ...baseResponse(
            "wave-verified",
            expectedSeq,
            start.cohort.digest,
            wave.index,
          ),
          committed: 10,
          uncommitted: 0,
          mismatch: 0,
          converted,
          retired,
          rows: rowCount,
          bytes,
          qualityRuns: 64,
          qualityObservations: 8_621,
        }
        lastWaveReceiptHash = sha(body)
        emit({ ...body, receiptSha256: lastWaveReceiptHash })
        expectedKind = "ack-wave"
      } else if (expectedKind === "ack-wave") {
        guard(command.receiptSha256 === lastWaveReceiptHash, "wave-ack")
        if (wavePosition === 9) {
          emit({
            ...baseResponse(
              "session-complete",
              expectedSeq,
              start.cohort.digest,
              wave.index,
            ),
            completedWaves: 10,
            completedRuns: 1_000,
          })
          return
        }
        emit({
          ...baseResponse(
            "wave-acked",
            expectedSeq,
            start.cohort.digest,
            wave.index,
          ),
        })
        wavePosition++
        batchPosition = 0
        lastWaveReceiptHash = undefined
        expectedKind = "freeze-batch"
      }
    }
    expectedSeq++
  }
  throw new Error("transport-eof")
}

async function main(): Promise<void> {
  guard(
    process.argv.length === 6 &&
      process.argv[2] === "--confirm-cohort" &&
      Hash.safeParse(process.argv[3]).success &&
      process.argv[4] === "--confirm-target" &&
      Hash.safeParse(process.argv[5]).success,
    "arguments",
  )
  const db = createPrismaClient("main")
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let lastInputAt = Date.now()
  lines.on("line", () => {
    lastInputAt = Date.now()
  })
  const timer = setInterval(() => {
    if (Date.now() - lastInputAt > 90_000) lines.close()
  }, 1_000)
  try {
    await runLegacyDetailSession(
      db,
      lines,
      (frame) => {
        process.stdout.write(JSON.stringify(frame) + "\n")
      },
      process.argv[3]!,
      process.argv[5]!,
    )
  } finally {
    clearInterval(timer)
    lines.close()
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: unknown) => {
    const reasons = new Set([
      "arguments",
      "frame-size",
      "sequence",
      "revision",
      "source",
      "lease",
      "cohort",
      "activation",
      "plan-digest",
      "cohort-roster",
      "row-budget",
      "cohort-size",
      "source-review",
      "quality-count",
      "quality-membership",
      "quality-selector",
      "quality-parent",
      "quality-observations",
      "quality-total",
      "permit",
      "retention-boundary",
      "execution-deadline",
      "target",
      "database-capacity",
      "read-scope",
      "read-membership",
      "batch-membership",
      "batch-baseline",
      "manifest",
      "wave-index",
      "batch-index",
      "wave-deadline",
      "manifest-ack",
      "attempt",
      "changed-baseline",
      "dry-run",
      "execution",
      "ledger",
      "after-parent",
      "after-retire",
      "after-convert",
      "wave-incomplete",
      "batch-unverified",
      "wave-ack",
      "transport-eof",
    ])
    process.stdout.write(
      JSON.stringify({
        kind: "stopped-uncertain",
        guard:
          error instanceof Error && reasons.has(error.message)
            ? error.message
            : null,
        rawDiagnosticsSuppressed: true,
      }) + "\n",
    )
    process.exitCode = 1
  })
