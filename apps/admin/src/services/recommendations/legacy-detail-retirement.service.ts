import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "./errors"
import {
  RETENTION_LOCK_ID,
  conversionDatabaseHash,
  traceSql,
  type ConversionHolds,
} from "./legacy-candidate-trace-conversion.service"
import { assertOriginalQualityHolds } from "./legacy-quality-holds"

type Database = Pick<PrismaClient, "$transaction" | "$queryRaw">
type Transaction = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">
type Candidate = {
  runId: string
  action: "convert" | "retire"
  fingerprint: string
  rows: number
  bytes: number
}
export type LegacyDetailRetirementManifest = {
  version: 1
  targetDatabaseHash: string
  createdBefore: string
  frozenAt: string
  holds: ConversionHolds
  candidates: Candidate[]
  digest: string
}
type Assessment = {
  fingerprint: string
  rows: number
  bytes: number
  eligible: boolean
}
const MAX_RUNS = 10
const MAX_ROWS = 4_000
const MAX_BYTES = 16 * 1024 * 1024

function digest(body: Omit<LegacyDetailRetirementManifest, "digest">): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex")
}

function validate(manifest: LegacyDetailRetirementManifest): void {
  assertOriginalQualityHolds(manifest.holds)
  const { digest: actual, ...body } = manifest
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.targetDatabaseHash) ||
    actual !== digest(body) ||
    !Number.isFinite(Date.parse(manifest.createdBefore)) ||
    !Number.isFinite(Date.parse(manifest.frozenAt)) ||
    Date.parse(manifest.createdBefore) > Date.parse(manifest.frozenAt) ||
    manifest.candidates.length < 1 ||
    manifest.candidates.length > MAX_RUNS ||
    new Set(manifest.candidates.map((c) => c.runId)).size !==
      manifest.candidates.length ||
    manifest.candidates.some(
      (c) =>
        !c.runId ||
        c.runId.length > 191 ||
        !["convert", "retire"].includes(c.action) ||
        !/^[a-f0-9]{32}$/.test(c.fingerprint) ||
        !Number.isInteger(c.rows) ||
        c.rows < (c.action === "retire" ? 1 : 0) ||
        c.rows > 448 ||
        !Number.isInteger(c.bytes) ||
        c.bytes < 1,
    ) ||
    manifest.candidates.reduce((n, c) => n + c.rows, 0) > MAX_ROWS ||
    manifest.candidates.reduce((n, c) => n + c.bytes, 0) > MAX_BYTES
  )
    throw new RecommendationInputError("Invalid legacy-detail manifest")
}

async function budgets(tx: Transaction): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout='1s'`
  await tx.$executeRaw`SET LOCAL statement_timeout='10s'`
  await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout='15s'`
}

async function linkedProtection(
  tx: Transaction,
  runId: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ protected: boolean }>>(Prisma.sql`
    SELECT (
      r.experiment_assignment_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM recommendation_shadow_run s
        WHERE s.request_id=r.id OR s.live_candidate_run_id=c.id)
      OR EXISTS (SELECT 1 FROM recommendation_experiment_exposure s WHERE s.request_id=r.id)
      OR EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence s WHERE s.request_id=r.id)
      OR EXISTS (SELECT 1 FROM recommendation_conflict s WHERE s.request_id=r.id)
      OR EXISTS (SELECT 1 FROM recommendation_trace_access_audit s WHERE s.request_id=r.id)
    ) AS protected
    FROM recommendation_candidate_run c
    JOIN recommendation_request r ON r.id=c.request_id WHERE c.id=${runId}
  `)
  if (!row) throw new RecommendationInputError("Candidate run disappeared")
  return row.protected
}

async function assess(
  tx: Transaction,
  runId: string,
  cutoff: string,
  policy: "selective" | "protected",
): Promise<Assessment> {
  const [row] = await tx.$queryRaw<Assessment[]>(Prisma.sql`
    ${traceSql(runId, cutoff, policy)}
    SELECT fingerprint, rows, bytes, eligible FROM assessment
  `)
  if (!row?.eligible)
    throw new RecommendationInputError(
      "Run changed, is uncertain, or cannot be represented exactly",
    )
  return row
}

/** Freeze at most ten explicit IDs after refreshing the private protection set. */
export async function freezeLegacyDetailRetirement(
  db: Database,
  input: { runIds: string[]; createdBefore: string; holds: ConversionHolds },
): Promise<LegacyDetailRetirementManifest> {
  assertOriginalQualityHolds(input.holds)
  if (
    input.runIds.length < 1 ||
    input.runIds.length > MAX_RUNS ||
    new Set(input.runIds).size !== input.runIds.length ||
    input.runIds.some((id) => !id || id.length > 191) ||
    !Number.isFinite(Date.parse(input.createdBefore)) ||
    Date.parse(input.createdBefore) > Date.now()
  )
    throw new RecommendationInputError(
      "Require at most ten distinct older run IDs",
    )
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await budgets(tx)
      const targetDatabaseHash = await conversionDatabaseHash(tx)
      const held = new Set([
        ...input.holds.qualityRunIds,
        ...input.holds.activeInvestigationRunIds,
      ])
      const candidates: Candidate[] = []
      for (const runId of [...input.runIds].sort()) {
        const action =
          held.has(runId) || (await linkedProtection(tx, runId))
            ? "convert"
            : "retire"
        const row = await assess(
          tx,
          runId,
          input.createdBefore,
          action === "convert" ? "protected" : "selective",
        )
        candidates.push({
          runId,
          action,
          fingerprint: row.fingerprint,
          rows: row.rows,
          bytes: row.bytes,
        })
      }
      const body = {
        version: 1 as const,
        targetDatabaseHash,
        createdBefore: input.createdBefore,
        frozenAt: new Date().toISOString(),
        holds: input.holds,
        candidates,
      }
      const manifest = { ...body, digest: digest(body) }
      validate(manifest)
      return manifest
    },
    { timeout: 30_000 },
  )
}

export async function runLegacyDetailRetirement(
  db: Database,
  manifest: LegacyDetailRetirementManifest,
  options: { execute?: boolean; confirmTarget?: string } = {},
): Promise<{
  status: "dry-run" | "completed" | "already-completed" | "retention-busy"
  converted: number
  retired: number
  rows: number
  bytes: number
}> {
  validate(manifest)
  return db.$transaction(
    async (tx) => {
      if (!options.execute) await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await budgets(tx)
      const target = await conversionDatabaseHash(tx)
      if (
        target !== manifest.targetDatabaseHash ||
        (options.execute && options.confirmTarget !== target)
      )
        throw new RecommendationInputError(
          "Target database confirmation mismatch",
        )
      if (options.execute) {
        const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_ID}) AS locked
      `
        if (!lock?.locked)
          return {
            status: "retention-busy",
            converted: 0,
            retired: 0,
            rows: 0,
            bytes: 0,
          }
        const [receipt] = await tx.$queryRaw<
          Array<{ manifest_digest: string }>
        >`
        SELECT manifest_digest FROM recommendation_legacy_detail_retirement_run
        WHERE manifest_digest=${manifest.digest}
      `
        if (receipt)
          return {
            status: "already-completed",
            converted: 0,
            retired: 0,
            rows: 0,
            bytes: 0,
          }
        if (
          Date.now() - Date.parse(manifest.frozenAt) > 15 * 60_000 ||
          Date.parse(manifest.frozenAt) > Date.now()
        )
          throw new RecommendationInputError(
            "Manifest protection snapshot is stale",
          )
      }
      let converted = 0,
        retired = 0,
        rows = 0,
        bytes = 0
      const held = new Set([
        ...manifest.holds.qualityRunIds,
        ...manifest.holds.activeInvestigationRunIds,
      ])
      for (const candidate of manifest.candidates) {
        if (options.execute) {
          await tx.$queryRaw`SELECT r.id FROM recommendation_request r
          JOIN recommendation_candidate_run c ON c.request_id=r.id
          WHERE c.id=${candidate.runId} FOR UPDATE OF r`
          await tx.$queryRaw`SELECT id FROM recommendation_candidate_run
          WHERE id=${candidate.runId} FOR UPDATE`
        }
        const protectedNow =
          held.has(candidate.runId) ||
          (await linkedProtection(tx, candidate.runId))
        if (protectedNow !== (candidate.action === "convert"))
          throw new RecommendationInputError(
            "Protection changed after manifest freeze",
          )
        const policy =
          candidate.action === "convert" ? "protected" : "selective"
        const row = await assess(
          tx,
          candidate.runId,
          manifest.createdBefore,
          policy,
        )
        if (
          row.fingerprint !== candidate.fingerprint ||
          row.rows !== candidate.rows ||
          row.bytes !== candidate.bytes
        )
          throw new RecommendationInputError(
            "Manifest source fingerprint changed",
          )
        rows += row.rows
        bytes += row.bytes
        if (rows > MAX_ROWS || bytes > MAX_BYTES)
          throw new RecommendationInputError("Retirement budget exceeded")
        if (!options.execute) continue
        const updated =
          candidate.action === "convert"
            ? await tx.$executeRaw(Prisma.sql`
            ${traceSql(candidate.runId, manifest.createdBefore, "protected")}
            UPDATE recommendation_candidate_run c
            SET trace_format_version=1, trace_payload=a.payload
            FROM assessment a
            WHERE c.id=${candidate.runId} AND a.eligible
              AND a.fingerprint=${candidate.fingerprint}
          `)
            : await tx.$executeRaw`
            UPDATE recommendation_candidate_run SET legacy_detail_retired_at=now()
            WHERE id=${candidate.runId} AND trace_format_version IS NULL
              AND trace_payload IS NULL AND legacy_detail_retired_at IS NULL
          `
        if (updated !== 1)
          throw new RecommendationInternalStateError(
            "Candidate update count mismatch",
          )
        const deleted = await tx.$executeRaw`
        DELETE FROM recommendation_candidate_stage_evidence
        WHERE run_id=${candidate.runId}
      `
        if (deleted !== row.rows)
          throw new RecommendationInternalStateError(
            "Stage deletion count mismatch",
          )
        if (candidate.action === "convert") converted++
        else retired++
      }
      if (options.execute)
        await tx.$executeRaw`
        INSERT INTO recommendation_legacy_detail_retirement_run
        (manifest_digest, target_database_hash, manifest_created_at,
         converted_runs, retired_runs, stage_rows_deleted, encoded_bytes)
        VALUES (${manifest.digest}, ${manifest.targetDatabaseHash},
          ${manifest.frozenAt}::timestamptz, ${converted}, ${retired}, ${rows}, ${bytes})
      `
      return {
        status: options.execute ? "completed" : "dry-run",
        converted,
        retired,
        rows,
        bytes,
      }
    },
    {
      // The run lock waits for in-flight stage writers. A fresh statement
      // snapshot after that wait must see their committed rows; a serializable
      // transaction snapshot could miss them and retire stale source detail.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30_000,
    },
  )
}
