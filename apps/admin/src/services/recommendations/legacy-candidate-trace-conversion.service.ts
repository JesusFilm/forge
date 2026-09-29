import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "./errors"

// Shared with retention.service.ts: acquire this BEFORE any root/run row lock.
export const RETENTION_LOCK_ID = 368_000_001
const MAX_RUNS = 10
const MAX_ROWS = 4_000
const MAX_BYTES = 16 * 1024 * 1024
type Database = Pick<PrismaClient, "$transaction" | "$queryRaw">
type Transaction = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">

export type ConversionHolds = {
  qualitySelectorSha256: string
  qualityRunIds: string[]
  activeInvestigationRunIds: string[]
}
export type ConversionManifest = {
  version: 1
  targetDatabaseHash: string
  createdBefore: string
  frozenAt: string
  holds: ConversionHolds
  maxEncodedBytes: number
  candidates: Array<{
    runId: string
    fingerprint: string
    rows: number
    bytes: number
  }>
  digest: string
}
type Assessment = {
  fingerprint: string
  rows: number
  bytes: number
  eligible: boolean
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function conversionManifestDigest(
  manifest: Omit<ConversionManifest, "digest">,
): string {
  return hash(JSON.stringify(manifest))
}

export function validateHolds(holds: ConversionHolds): void {
  if (
    !/^[a-f0-9]{64}$/.test(holds.qualitySelectorSha256) ||
    holds.qualityRunIds.length !== 64 ||
    new Set(holds.qualityRunIds).size !== 64 ||
    [...holds.qualityRunIds, ...holds.activeInvestigationRunIds].some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > 191,
    )
  )
    throw new RecommendationInputError(
      "Require the frozen 64-run quality sample and reviewed investigation holds",
    )
}

export function validateConversionManifest(manifest: ConversionManifest): void {
  validateHolds(manifest.holds)
  const { digest, ...body } = manifest
  const held = new Set([
    ...manifest.holds.qualityRunIds,
    ...manifest.holds.activeInvestigationRunIds,
  ])
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.targetDatabaseHash) ||
    digest !== conversionManifestDigest(body) ||
    !Number.isFinite(Date.parse(manifest.createdBefore)) ||
    !Number.isFinite(Date.parse(manifest.frozenAt)) ||
    Date.parse(manifest.createdBefore) >
      Date.parse(manifest.frozenAt) - 14 * 86_400_000 ||
    !Number.isInteger(manifest.maxEncodedBytes) ||
    manifest.maxEncodedBytes < 1 ||
    manifest.maxEncodedBytes > MAX_BYTES ||
    manifest.candidates.length < 1 ||
    manifest.candidates.length > MAX_RUNS ||
    new Set(manifest.candidates.map((c) => c.runId)).size !==
      manifest.candidates.length ||
    manifest.candidates.some(
      (c) =>
        held.has(c.runId) ||
        !c.runId ||
        c.runId.length > 191 ||
        !/^[a-f0-9]{32}$/.test(c.fingerprint) ||
        !Number.isInteger(c.rows) ||
        c.rows < 1 ||
        c.rows > 448 ||
        !Number.isInteger(c.bytes) ||
        c.bytes < 1,
    ) ||
    manifest.candidates.reduce((n, c) => n + c.rows, 0) > MAX_ROWS ||
    manifest.candidates.reduce((n, c) => n + c.bytes, 0) >
      manifest.maxEncodedBytes
  )
    throw new RecommendationInputError(
      "Invalid, held, stale or over-budget conversion manifest",
    )
}

/** No URL, credential, profile or raw evidence leaves the database. */
export async function conversionDatabaseHash(
  db: Pick<Database, "$queryRaw">,
): Promise<string> {
  const [row] = await db.$queryRaw<Array<{ identity: string }>>(Prisma.sql`
    SELECT concat_ws(':', current_database(), current_schema(),
      coalesce(inet_server_addr()::text, 'unix'), inet_server_port()::text) AS identity
  `)
  if (!row) throw new RecommendationInputError("Database identity unavailable")
  return hash(row.identity)
}

/** Explicit keys; historical JSON/numbers never pass through JavaScript.
 * Reconstruct the real table row type, including inherited expiry/identity,
 * and compare BOTH directions. A validator success alone is not parity.
 */
export function traceSql(
  runId: string,
  createdBefore: string,
  policy: "selective" | "protected" = "selective",
) {
  return Prisma.sql`
    WITH source_run AS MATERIALIZED (
      SELECT c.*, to_jsonb(r) AS root_snapshot,
        r.expires_at AS root_expiry, r.created_at AS root_created,
        r.result AS root_result, r.experiment_assignment_id
      FROM recommendation_candidate_run c
      JOIN recommendation_request r ON r.id=c.request_id WHERE c.id=${runId}
    ), source AS MATERIALIZED (
      SELECT e.* FROM recommendation_candidate_stage_evidence e WHERE e.run_id=${runId}
    ), encoded AS MATERIALIZED (
      SELECT jsonb_build_object('stages', coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'stage', e.stage, 'ordinal', e.ordinal,
        'candidateKey', e.candidate_key, 'targetMediaId', e.target_media_id,
        'sourceGenerator', e.source_generator, 'sourceRank', e.source_rank,
        'sourceScore', e.source_score, 'normalizedScore', e.normalized_score,
        'rrfScore', e.rrf_score, 'deterministicScore', e.deterministic_score,
        'finalPosition', e.final_position, 'reasonCodes', e.reason_codes,
        'sourceEvidence', e.source_evidence,
        'createdAt', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) ORDER BY e.stage,e.ordinal), '[]'::jsonb)) AS payload,
      count(*)::integer AS rows FROM source e
    ), decoded AS MATERIALIZED (
      SELECT (jsonb_populate_record(NULL::recommendation_candidate_stage_evidence,
        jsonb_build_object('id', v->'id', 'run_id', c.id,
          'stage', v->'stage', 'ordinal', v->'ordinal', 'candidate_key', v->'candidateKey',
          'target_media_id', v->'targetMediaId', 'source_generator', v->'sourceGenerator',
          'source_rank', v->'sourceRank', 'source_score', v->'sourceScore',
          'normalized_score', v->'normalizedScore', 'rrf_score', v->'rrfScore',
          'deterministic_score', v->'deterministicScore', 'final_position', v->'finalPosition',
          'reason_codes', v->'reasonCodes', 'source_evidence', v->'sourceEvidence',
          'created_at', v->'createdAt', 'expires_at', c.expires_at))).*
      FROM source_run c, encoded x, jsonb_array_elements(x.payload->'stages') v
    ), assessment AS (
      SELECT x.payload, x.rows, octet_length(x.payload::text)::integer AS bytes,
        md5((to_jsonb(c)::text) || x.payload::text) AS fingerprint,
        c.trace_format_version IS NULL AND c.trace_payload IS NULL
        AND c.legacy_detail_retired_at IS NULL
        AND c.created_at < ${createdBefore}::timestamptz
        AND c.root_created < ${createdBefore}::timestamptz
        AND c.root_expiry > clock_timestamp() AND c.expires_at = c.root_expiry
        ${
          policy === "selective"
            ? Prisma.sql`
        AND c.evidence_complete AND c.composed_count > 0
        AND c.root_result IN ('served','fallback')
        AND c.generator_version <> 'seeded-curated-empty-fallback-v1'
        `
            : Prisma.empty
        }
        ${
          policy === "selective"
            ? Prisma.sql`
        AND c.experiment_assignment_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM recommendation_shadow_run s WHERE s.request_id=c.request_id OR s.live_candidate_run_id=c.id)
        AND NOT EXISTS(SELECT 1 FROM recommendation_experiment_exposure s WHERE s.request_id=c.request_id)
        AND NOT EXISTS(SELECT 1 FROM recommendation_promotion_slate_fence s WHERE s.request_id=c.request_id)
        AND NOT EXISTS(SELECT 1 FROM recommendation_conflict s WHERE s.request_id=c.request_id)
        AND NOT EXISTS(SELECT 1 FROM recommendation_trace_access_audit s WHERE s.request_id=c.request_id)
        `
            : Prisma.empty
        }
        AND x.rows BETWEEN ${policy === "protected" ? 0 : 1} AND 448
        AND valid_recommendation_candidate_trace_v1(x.payload)
        AND NOT EXISTS(SELECT 1 FROM source e WHERE e.expires_at<>c.expires_at
          OR e.created_at<>date_trunc('milliseconds',e.created_at))
        AND c.nominated_count=(SELECT count(*) FROM source WHERE stage='nominated')
        AND c.canonicalized_count=(SELECT count(*) FROM source WHERE stage='canonicalized')
        AND c.deduplicated_count=(SELECT count(*) FROM source WHERE stage='deduplicated')
        AND c.rejected_count=(SELECT count(*) FROM source WHERE stage='rejected')
        AND c.scored_count=(SELECT count(*) FROM source WHERE stage='scored')
        AND c.ordered_count=(SELECT count(*) FROM source WHERE stage='ordered')
        AND c.composed_count=(SELECT count(*) FROM source WHERE stage='composed')
        AND NOT EXISTS((SELECT * FROM source EXCEPT ALL SELECT * FROM decoded)
          UNION ALL (SELECT * FROM decoded EXCEPT ALL SELECT * FROM source)) AS eligible
      FROM source_run c CROSS JOIN encoded x
    )
  `
}

async function assess(
  tx: Transaction,
  runId: string,
  cutoff: string,
): Promise<Assessment | undefined> {
  const [row] = await tx.$queryRaw<Assessment[]>(Prisma.sql`
    ${traceSql(runId, cutoff)} SELECT fingerprint, rows, bytes, eligible FROM assessment
  `)
  return row
}

async function budgets(tx: Transaction): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout='1s'`
  await tx.$executeRaw`SET LOCAL statement_timeout='10s'`
  await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout='15s'`
}

/** Freeze a small explicit pilot AFTER materializing the historical holds.
 * Every manifest pins source contents, selector cutoff and database identity.
 */
export async function freezeConversionManifest(
  db: Database,
  input: {
    runIds: string[]
    createdBefore: string
    holds: ConversionHolds
    maxEncodedBytes?: number
  },
): Promise<ConversionManifest> {
  validateHolds(input.holds)
  const held = new Set([
    ...input.holds.qualityRunIds,
    ...input.holds.activeInvestigationRunIds,
  ])
  if (
    input.runIds.length < 1 ||
    input.runIds.length > MAX_RUNS ||
    new Set(input.runIds).size !== input.runIds.length ||
    input.runIds.some((id) => !id || id.length > 191 || held.has(id)) ||
    !Number.isFinite(Date.parse(input.createdBefore)) ||
    Date.parse(input.createdBefore) > Date.now() - 14 * 86_400_000 ||
    (input.maxEncodedBytes !== undefined &&
      (!Number.isInteger(input.maxEncodedBytes) ||
        input.maxEncodedBytes < 1 ||
        input.maxEncodedBytes > MAX_BYTES))
  ) {
    throw new RecommendationInputError(
      "Bound the pilot to 1–10 unique unheld older runs and a finite byte budget",
    )
  }
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await budgets(tx)
      const targetDatabaseHash = await conversionDatabaseHash(tx)
      const candidates = []
      for (const runId of [...input.runIds].sort()) {
        const row = await assess(tx, runId, input.createdBefore)
        if (!row?.eligible)
          throw new RecommendationInputError(
            "Pilot contains an ineligible or unrepresentable run",
          )
        candidates.push({
          runId,
          fingerprint: row.fingerprint,
          rows: row.rows,
          bytes: row.bytes,
        })
      }
      const body: Omit<ConversionManifest, "digest"> = {
        version: 1,
        targetDatabaseHash,
        createdBefore: input.createdBefore,
        frozenAt: new Date().toISOString(),
        holds: input.holds,
        maxEncodedBytes: input.maxEncodedBytes ?? 4 * 1024 * 1024,
        candidates,
      }
      const manifest = { ...body, digest: conversionManifestDigest(body) }
      validateConversionManifest(manifest)
      return manifest
    },
    { timeout: 30_000 },
  )
}

export async function convertLegacyCandidateTraces(
  db: Database,
  manifest: ConversionManifest,
  options: { execute?: boolean; confirmTarget?: string } = {},
): Promise<{
  status: "dry-run" | "converted" | "retention-busy"
  converted: number
  skipped: number
  rows: number
  bytes: number
}> {
  validateConversionManifest(manifest)
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
            skipped: 0,
            rows: 0,
            bytes: 0,
          }
      }
      let converted = 0,
        skipped = 0,
        rows = 0,
        bytes = 0
      for (const candidate of [...manifest.candidates].sort((a, b) =>
        a.runId.localeCompare(b.runId),
      )) {
        if (options.execute) {
          // Root first protects FK-linked evidence writers; run second protects stages.
          await tx.$queryRaw`SELECT r.id FROM recommendation_request r
          JOIN recommendation_candidate_run c ON c.request_id=r.id WHERE c.id=${candidate.runId} FOR UPDATE OF r`
          await tx.$queryRaw`SELECT id FROM recommendation_candidate_run WHERE id=${candidate.runId} FOR UPDATE`
        }
        const row = await assess(tx, candidate.runId, manifest.createdBefore)
        if (
          !row?.eligible ||
          row.fingerprint !== candidate.fingerprint ||
          row.rows !== candidate.rows ||
          row.bytes !== candidate.bytes
        ) {
          skipped++
          continue
        }
        rows += row.rows
        bytes += row.bytes
        if (rows > MAX_ROWS || bytes > manifest.maxEncodedBytes)
          throw new RecommendationInputError("Conversion budget exceeded")
        if (options.execute) {
          const updated = await tx.$executeRaw(Prisma.sql`
          ${traceSql(candidate.runId, manifest.createdBefore)}
          UPDATE recommendation_candidate_run c SET trace_format_version=1,trace_payload=a.payload
          FROM assessment a WHERE c.id=${candidate.runId} AND a.eligible AND a.fingerprint=${candidate.fingerprint}
        `)
          if (updated !== 1)
            throw new RecommendationInternalStateError(
              "Source changed during conversion",
            )
          const deleted = await tx.$executeRaw`
          DELETE FROM recommendation_candidate_stage_evidence WHERE run_id=${candidate.runId}
        `
          if (deleted !== row.rows)
            throw new RecommendationInternalStateError(
              "Stage deletion count mismatch",
            )
          converted++
        }
      }
      return {
        status: options.execute ? "converted" : "dry-run",
        converted,
        skipped,
        rows,
        bytes,
      }
    },
    {
      // Stage writers can hold the run row while inserting. Reassess with a
      // fresh snapshot after the run lock waits for those writers to commit.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30_000,
    },
  )
}
