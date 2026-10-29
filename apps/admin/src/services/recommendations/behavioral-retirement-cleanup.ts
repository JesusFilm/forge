import { createHash, randomUUID } from "node:crypto"
import type { Client } from "pg"
import { z } from "zod"

const Commit = z.string().regex(/^[a-f0-9]{40}$/)
const Uuid = z.uuid()
const CutoverProof = z.strictObject({
  kind: z.literal("recommendation-behavioral-retirement-cutover-v1"),
  releaseACommit: Commit,
  releaseBCommit: Commit,
  releaseAAllRolesVerifiedAt: z.iso.datetime(),
  releaseBAllRolesVerifiedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  httpRevision: Commit,
  workerRevision: Commit,
  oldReplicasAbsent: z.literal(true),
  oldLearnerRuntimesTerminal: z.literal(true),
  parentApprovedCleanup: z.literal(true),
})

export type RetirementCutoverProof = z.infer<typeof CutoverProof>

export function parseRetirementCutoverProof(input: {
  bytes: Buffer
  sha256: string
  expectedReleaseA: string
  runningReleaseB: string
  now?: Date
}): RetirementCutoverProof {
  if (!/^[a-f0-9]{64}$/.test(input.sha256))
    throw new Error("Invalid cutover proof digest")
  if (createHash("sha256").update(input.bytes).digest("hex") !== input.sha256)
    throw new Error("Cutover proof digest mismatch")
  const proof = CutoverProof.parse(JSON.parse(input.bytes.toString("utf8")))
  const now = input.now ?? new Date()
  if (
    proof.releaseACommit !== input.expectedReleaseA ||
    proof.releaseBCommit !== input.runningReleaseB ||
    proof.httpRevision !== input.runningReleaseB ||
    proof.workerRevision !== input.runningReleaseB ||
    new Date(proof.releaseAAllRolesVerifiedAt).getTime() >=
      new Date(proof.releaseBAllRolesVerifiedAt).getTime() ||
    new Date(proof.releaseBAllRolesVerifiedAt).getTime() > now.getTime() ||
    new Date(proof.expiresAt).getTime() <= now.getTime() ||
    new Date(proof.expiresAt).getTime() -
      new Date(proof.releaseBAllRolesVerifiedAt).getTime() >
      60 * 60_000
  )
    throw new Error("Cutover proof is stale or not source-bound")
  return proof
}

type DeletePhase = Readonly<{
  name: string
  kind: "delete"
  table: string
  key: string
  protectedRefs?: string
}>
type DetachPhase = Readonly<{
  name: string
  kind: "detach"
  table: string
  key: string
  where: string
  update: string
}>
type Phase = DeletePhase | DetachPhase

/** Identifiers and predicates are source-owned constants, never CLI inputs. */
export const RETIREMENT_PHASES = [
  {
    name: "refresh_attempt",
    kind: "delete",
    table: "recommendation_cowatch_refresh_attempt",
    key: "id",
  },
  {
    name: "refresh_grant",
    kind: "delete",
    table: "recommendation_cowatch_refresh_grant",
    key: "id",
  },
  {
    name: "profile_interest",
    kind: "delete",
    table: "recommendation_profile_interest",
    key: "id",
  },
  {
    name: "profile_contribution",
    kind: "delete",
    table: "recommendation_profile_projection_contribution",
    key: "id",
  },
  {
    name: "profile_pointer",
    kind: "delete",
    table: "recommendation_profile_projection_pointer",
    key: "scope_digest",
  },
  {
    name: "profile_run",
    kind: "delete",
    table: "recommendation_profile_projection_run",
    key: "id",
  },
  {
    name: "consent_receipt",
    kind: "delete",
    table: "recommendation_consent_receipt",
    key: "id",
  },
  {
    name: "consent_transition",
    kind: "delete",
    table: "recommendation_consent_transition",
    key: "id",
  },
  {
    name: "profile_session",
    kind: "delete",
    table: "recommendation_profile_session_link",
    key: "id",
  },
  {
    name: "viewing_evidence",
    kind: "delete",
    table: "recommendation_viewing_mode_evidence",
    key: "episode_id",
  },
  {
    name: "decision_detach",
    kind: "detach",
    table: "recommendation_personalization_decision",
    key: "request_id",
    where: "projection_generation_id IS NOT NULL",
    update: "projection_generation_id = NULL",
  },
  {
    name: "assignment_detach",
    kind: "detach",
    table: "recommendation_experiment_assignment",
    key: "id",
    where: "profile_id IS NOT NULL",
    update:
      "profile_id = NULL, privacy_generation = NULL, state = 'fenced', fenced_at = COALESCE(fenced_at, clock_timestamp()), fence_reason = COALESCE(fence_reason, 'behavioral_retirement')",
  },
  {
    name: "shadow_detach",
    kind: "detach",
    table: "recommendation_shadow_run",
    key: "id",
    where: "projection_profile_id IS NOT NULL",
    update: "projection_profile_id = NULL, privacy_generation = NULL",
  },
  {
    name: "profile_generation",
    kind: "delete",
    table: "recommendation_profile_projection_generation",
    key: "id",
    protectedRefs:
      "EXISTS (SELECT 1 FROM recommendation_personalization_decision d WHERE d.projection_generation_id = target.id)",
  },
  {
    name: "vector_snapshot",
    kind: "delete",
    table: "recommendation_profile_vector_snapshot",
    key: "digest",
  },
  {
    name: "cowatch_edge",
    kind: "delete",
    table: "recommendation_cowatch_edge",
    key: "id",
  },
  {
    name: "cowatch_pair",
    kind: "delete",
    table: "recommendation_cowatch_contribution",
    key: "id",
  },
  {
    name: "cowatch_source",
    kind: "delete",
    table: "recommendation_cowatch_source_contribution",
    key: "id",
  },
  {
    name: "cowatch_suppression",
    kind: "delete",
    table: "recommendation_cowatch_suppression",
    key: "episode_id",
  },
  {
    name: "cowatch_authority",
    kind: "delete",
    table: "recommendation_cowatch_trial_authority",
    key: "generation_id",
  },
  {
    name: "cowatch_generation",
    kind: "delete",
    table: "recommendation_cowatch_generation",
    key: "id",
  },
  {
    name: "profile",
    kind: "delete",
    table: "recommendation_profile",
    key: "id",
    protectedRefs:
      "EXISTS (SELECT 1 FROM recommendation_experiment_assignment a WHERE a.profile_id = target.id) OR EXISTS (SELECT 1 FROM recommendation_shadow_run s WHERE s.projection_profile_id = target.id)",
  },
] as const satisfies readonly Phase[]

export type RetirementPhaseName = (typeof RETIREMENT_PHASES)[number]["name"]
export type RetirementBatch = Readonly<{
  batchId: string
  phase: RetirementPhaseName
  deleted: number
  updated: number
}>
export type RetirementWindowResult = Readonly<{
  status:
    | "complete"
    | "batch_limit"
    | "locked_rows"
    | "blocked_references"
    | "busy"
  batches: RetirementBatch[]
  nextPhase: RetirementPhaseName | null
}>

export class RetirementAdmissionError extends Error {}
export class RetirementBatchFailureError extends Error {
  constructor(
    readonly batchId: string,
    readonly phase: RetirementPhaseName,
    readonly sqlstate: string | null,
  ) {
    super("Retirement batch failed and its transaction rolled back")
  }
}
export class RetirementUncertainCommitError extends Error {
  constructor(
    readonly batchId: string,
    readonly phase: RetirementPhaseName,
    readonly durableState: "committed" | "absent" | "unknown",
  ) {
    super(
      "Retirement batch acknowledgement failed; stop and inspect its durable receipt",
    )
  }
}

function phaseSql(phase: Phase): string {
  const filter = phase.kind === "detach" ? `WHERE ${phase.where}` : ""
  const mutation =
    phase.kind === "delete"
      ? `DELETE FROM ${phase.table} target USING picked WHERE target.${phase.key} = picked.${phase.key} RETURNING target.${phase.key}`
      : `UPDATE ${phase.table} target SET ${phase.update} FROM picked WHERE target.${phase.key} = picked.${phase.key} RETURNING target.${phase.key}`
  return `WITH picked AS MATERIALIZED (
    SELECT ${phase.key} FROM ${phase.table} ${filter}
    ORDER BY ${phase.key} LIMIT $1 FOR UPDATE SKIP LOCKED
  ), changed AS (${mutation})
  INSERT INTO recommendation_behavioral_retirement_batch
    (batch_id, operation_id, sequence, phase, deleted_count, updated_count, source_commit)
  SELECT $2::uuid, $3::uuid, $4::integer, $5::varchar(80),
    ${phase.kind === "delete" ? "count(*)::integer, 0" : "0, count(*)::integer"}, $6::char(40)
  FROM changed HAVING count(*) > 0
  RETURNING deleted_count, updated_count`
}

/** The parent row is locked by a prior statement in this transaction. The
 * second statement gets a fresh READ COMMITTED snapshot after any earlier FK
 * key-share holder has finished, and cannot miss a later child insert. */
function protectedParentSql(
  phase: DeletePhase & { protectedRefs: string },
): string {
  return `WITH changed AS (
    DELETE FROM ${phase.table} target
    WHERE target.${phase.key} = ANY($1::text[])
      AND NOT (${phase.protectedRefs})
    RETURNING target.${phase.key}
  )
  INSERT INTO recommendation_behavioral_retirement_batch
    (batch_id, operation_id, sequence, phase, deleted_count, updated_count, source_commit)
  SELECT $2::uuid, $3::uuid, $4::integer, $5::varchar(80), count(*)::integer, 0,
    $6::char(40)
  FROM changed HAVING count(*) > 0
  RETURNING deleted_count, updated_count`
}

async function assertAdmission(client: Client): Promise<void> {
  const catalog = await client.query<{ ready: boolean }>(`SELECT
    to_regclass('recommendation_behavioral_retirement_batch') IS NOT NULL
    AND to_regclass('workflow.workflow_runs') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('recommendation_experiment_assignment')
      AND conname = 'recommendation_experiment_assignment_retirement_privacy_check')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('recommendation_shadow_run')
      AND conname = 'recommendation_shadow_run_profile_fkey' AND confdeltype = 'c')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('recommendation_personalization_decision')
      AND conname = 'recommendation_personalization_projection_fkey' AND confdeltype = 'n')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('recommendation_experiment_assignment')
      AND conname = 'recommendation_experiment_assignment_profile_fkey' AND confdeltype = 'c') AS ready`)
  if (!catalog.rows[0]?.ready)
    throw new RetirementAdmissionError("Retirement schema guard not deployed")
  const active = await client.query<{
    blocked: boolean
  }>(`WITH retired(workflow_key, runtime_name) AS (VALUES
      ('recommendation-profile-projection',
       'workflow//./src/workflows/recommendationProfileProjection//runRecommendationProfileProjection'),
      ('recommendation-profile-reconciliation-scheduler',
       'workflow//./src/workflows/recommendationProfileReconciliation//runRecommendationProfileReconciliationScheduler'),
      ('recommendation-cowatch-refresh-scheduler',
       'workflow//./src/workflows/recommendationCowatchRefresh//runRecommendationCowatchRefreshScheduler'),
      ('recommendation-shadow-evaluation',
       'workflow//./src/workflows/recommendationShadowEvaluation//runRecommendationShadowEvaluation'),
      ('recommendation-experiment-evaluation',
       'workflow//./src/workflows/recommendationExperimentEvaluation//runRecommendationExperimentEvaluation')
    ) SELECT
    EXISTS (SELECT 1 FROM recommendation_profile_projection_run WHERE state IN ('pending', 'claimed'))
    OR EXISTS (SELECT 1 FROM recommendation_profile_projection_generation WHERE state = 'building')
    OR EXISTS (SELECT 1 FROM recommendation_shadow_run WHERE state IN ('pending', 'claimed'))
    OR EXISTS (SELECT 1 FROM recommendation_experiment_evaluation_run WHERE state IN ('pending', 'claimed'))
    OR EXISTS (SELECT 1 FROM recommendation_cowatch_refresh_attempt WHERE status = 'running')
    OR EXISTS (SELECT 1 FROM workflow.workflow_runs runtime
      JOIN retired ON retired.runtime_name = runtime.name
      WHERE runtime.status IS NULL OR runtime.status NOT IN ('completed', 'failed', 'cancelled'))
    OR EXISTS (SELECT 1 FROM workflow_run ledger
      JOIN retired ON retired.workflow_key = ledger.workflow_key
      LEFT JOIN workflow.workflow_runs runtime ON runtime.id = ledger.runtime_run_id
      WHERE ledger.runtime_run_id IS NULL OR runtime.id IS NULL
        OR runtime.name IS DISTINCT FROM retired.runtime_name
        OR runtime.status IS NULL
        OR runtime.status NOT IN ('completed', 'failed', 'cancelled')) AS blocked`)
  if (active.rows[0]?.blocked)
    throw new RetirementAdmissionError(
      "Known behavioral learner is nonterminal",
    )
}

/** One finite window. The caller owns a connected, dedicated client. */
export async function runBehavioralRetirementWindow(
  client: Client,
  input: {
    operationId: string
    sourceCommit: string
    batchSize: number
    maxBatches: number
    cutoverProof: RetirementCutoverProof
    reconnectForReceipt: () => Promise<Client>
  },
): Promise<RetirementWindowResult> {
  Uuid.parse(input.operationId)
  Commit.parse(input.sourceCommit)
  if (
    input.sourceCommit !== input.cutoverProof.releaseBCommit ||
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 100 ||
    !Number.isInteger(input.maxBatches) ||
    input.maxBatches < 1 ||
    input.maxBatches > 20
  )
    throw new RetirementAdmissionError(
      "Invalid bounded retirement source or limits",
    )

  const lock = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(368000099) AS acquired",
  )
  if (!lock.rows[0]?.acquired)
    return { status: "busy", batches: [], nextPhase: null }
  let retentionLock = false
  try {
    await client.query("SET statement_timeout = '5s'")
    await client.query("SET lock_timeout = '1s'")
    const shared = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(368000001) AS acquired",
    )
    if (!shared.rows[0]?.acquired)
      return { status: "busy", batches: [], nextPhase: null }
    retentionLock = true
    await assertAdmission(client)
    const history = await client.query<{
      sequence: number
      source_changed: boolean
    }>(
      `SELECT COALESCE(MAX(sequence), -1)::integer AS sequence,
        COALESCE(BOOL_OR(source_commit <> $2::char(40)), false) AS source_changed
       FROM recommendation_behavioral_retirement_batch WHERE operation_id = $1`,
      [input.operationId, input.sourceCommit],
    )
    if (history.rows[0]?.source_changed)
      throw new RetirementAdmissionError("Operation source revision changed")
    let sequence = (history.rows[0]?.sequence ?? -1) + 1
    const batches: RetirementBatch[] = []
    for (const phase of RETIREMENT_PHASES) {
      while (true) {
        if (batches.length >= input.maxBatches)
          return { status: "batch_limit", batches, nextPhase: phase.name }
        const batchId = randomUUID()
        let count: { deleted_count: number; updated_count: number } | undefined
        let commitStarted = false
        let mutationIssued = false
        try {
          await client.query("BEGIN")
          await client.query("SET LOCAL transaction_timeout = '5s'")
          await client.query("SET LOCAL statement_timeout = '5s'")
          await client.query("SET LOCAL lock_timeout = '1s'")
          const protectedRefs =
            "protectedRefs" in phase ? phase.protectedRefs : undefined
          const selected = protectedRefs
            ? await client.query<{ id: string }>(
                `SELECT ${phase.key} AS id FROM ${phase.table} ORDER BY ${phase.key} LIMIT $1 FOR UPDATE SKIP LOCKED`,
                [input.batchSize],
              )
            : null
          mutationIssued = selected === null || selected.rows.length > 0
          const changed = await client.query<{
            deleted_count: number
            updated_count: number
          }>(
            protectedRefs
              ? protectedParentSql(
                  phase as DeletePhase & { protectedRefs: string },
                )
              : phaseSql(phase),
            [
              protectedRefs
                ? selected?.rows.map(({ id }) => id)
                : input.batchSize,
              batchId,
              input.operationId,
              sequence,
              phase.name,
              input.sourceCommit,
            ],
          )
          count = changed.rows[0]
          commitStarted = true
          await client.query("COMMIT")
        } catch (error) {
          const errorCode = (error as { code?: unknown })?.code
          const sqlstate =
            typeof errorCode === "string" && /^[A-Z0-9]{5}$/.test(errorCode)
              ? errorCode
              : null
          let rolledBack = false
          if (!commitStarted) {
            try {
              await client.query("ROLLBACK")
              rolledBack = true
            } catch {
              /* the transaction outcome needs a separate receipt */
            }
          }
          if (!commitStarted && (!mutationIssued || rolledBack))
            throw new RetirementBatchFailureError(batchId, phase.name, sqlstate)
          const receiptClient = await input
            .reconnectForReceipt()
            .catch(() => null)
          let durableState: "committed" | "absent" | "unknown" = "unknown"
          if (receiptClient) {
            try {
              const receipt = await receiptClient.query<{
                deleted_count: number
                updated_count: number
              }>(
                `SELECT deleted_count, updated_count
                 FROM recommendation_behavioral_retirement_batch WHERE batch_id = $1`,
                [batchId],
              )
              durableState = receipt.rows[0] ? "committed" : "absent"
            } catch {
              durableState = "unknown"
            } finally {
              await receiptClient.end().catch(() => undefined)
            }
          }
          throw new RetirementUncertainCommitError(
            batchId,
            phase.name,
            durableState,
          )
        }
        if (count) {
          batches.push({
            batchId,
            phase: phase.name,
            deleted: count.deleted_count,
            updated: count.updated_count,
          })
          sequence += 1
          continue
        }
        const where = phase.kind === "detach" ? `WHERE ${phase.where}` : ""
        const remaining = await client.query<{ present: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM ${phase.table} ${where} LIMIT 1) AS present`,
        )
        const protectedRefs =
          "protectedRefs" in phase ? phase.protectedRefs : undefined
        if (remaining.rows[0]?.present && protectedRefs) {
          const blocked = await client.query<{ present: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM ${phase.table} target WHERE ${protectedRefs} LIMIT 1) AS present`,
          )
          if (blocked.rows[0]?.present)
            return {
              status: "blocked_references",
              batches,
              nextPhase: phase.name,
            }
        }
        if (remaining.rows[0]?.present)
          return { status: "locked_rows", batches, nextPhase: phase.name }
        break
      }
    }
    return { status: "complete", batches, nextPhase: null }
  } finally {
    if (retentionLock)
      await client
        .query("SELECT pg_advisory_unlock(368000001)")
        .catch(() => undefined)
    await client
      .query("SELECT pg_advisory_unlock(368000099)")
      .catch(() => undefined)
  }
}
