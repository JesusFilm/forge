import { Prisma, type PrismaClient } from "@prisma/client"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import { gaCaptureSnapshotRefSchema } from "./ga-capture-artifact"
import {
  configuredGaCaptureStore,
  gaCaptureStorageKey,
  type GaCaptureStore,
} from "./ga-capture-store"

/** Terminal diagnostics remain reviewable for three months. This never alters
 * the request-owned 29-day raw visit lifecycle or fixed-test aggregates. */
export const PRECOMPUTED_TERMINAL_RETENTION_DAYS = 90
export const PRECOMPUTED_ABANDONED_IDLE_DAYS = 30
export const PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE = 100
export const PRECOMPUTED_RETENTION_PROOF_DAYS = 365
const SOURCE_PAGE_SIZE = 20

type Tx = Prisma.TransactionClient

export type PrecomputedGenerationPurge = Readonly<{
  generationsAbandoned: number
  generationsRetiring: number
  generationsDeleted: number
  finalSourcesDeleted: number
  buildSourcesDeleted: number
  provisionalChoicesDeleted: number
  modelCallsDeleted: number
  profileCallsDeleted: number
  profilesDeleted: number
  edgeBatchMembersDeleted: number
  edgeBatchCallsDeleted: number
  executionAttemptsDeleted: number
  historyCallsDeleted: number
  provisionalChoicesPruned: number
  checkpointsCleared: number
  proofsDeleted: number
  pageFull: boolean
}>

/** One bounded page in the ordinary retention transaction. The generation row
 * lock serializes late provider receipts, experiment pins, and hold updates;
 * the experiment FK remains the final safety backstop. */
export async function purgeExpiredPrecomputedGenerations(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<PrecomputedGenerationPurge> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("precomputed_generation_purge_invalid_limit")
  const cutoff = new Date(
    now.getTime() - PRECOMPUTED_TERMINAL_RETENTION_DAYS * 86_400_000,
  )
  const idleCutoff = new Date(
    now.getTime() - PRECOMPUTED_ABANDONED_IDLE_DAYS * 86_400_000,
  )
  const proofsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_generation_retention_proof proof
    WHERE proof.ctid IN (
      SELECT expired.ctid FROM recommendation_precomputed_generation_retention_proof expired
      WHERE expired.expires_at <= ${now}
        AND (expired.snapshot_sha256 IS NULL OR expired.artifact_deleted_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_ga_capture_artifact artifact
          WHERE artifact.generation_id = expired.generation_id
        )
      ORDER BY expired.expires_at, expired.generation_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const [abandoned] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT g.id FROM recommendation_precomputed_generation g
    WHERE g.status IN ('incomplete', 'capacity_blocked')
      AND g.created_at <= ${idleCutoff}
      AND (g.manifest_committed_at IS NULL OR g.manifest_committed_at <= ${idleCutoff})
      AND (g.capacity_preflight->>'measuredAt' IS NULL OR
        (g.capacity_preflight->>'measuredAt')::timestamptz <= ${idleCutoff})
      AND NOT g.rollback_retention_hold
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_experiment e WHERE e.generation_id = g.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_build_source s
        WHERE s.generation_id = g.id
          AND (s.updated_at > ${idleCutoff} OR s.lease_expires_at > ${now})
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_model_call c
        WHERE c.generation_id = g.id
          AND (c.started_at > ${idleCutoff} OR c.finished_at > ${idleCutoff})
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_content_profile p
        WHERE p.generation_id = g.id AND p.updated_at > ${idleCutoff}
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_profile_call c
        WHERE c.generation_id = g.id
          AND (c.started_at > ${idleCutoff} OR c.finished_at > ${idleCutoff})
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_edge_batch_call c
        WHERE c.generation_id = g.id
          AND (c.started_at > ${idleCutoff} OR c.finished_at > ${idleCutoff})
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_history_call c
        WHERE c.generation_id = g.id
          AND (c.started_at > ${idleCutoff} OR c.finished_at > ${idleCutoff})
      )
    ORDER BY g.created_at, g.id LIMIT 1 FOR UPDATE OF g SKIP LOCKED
  `)
  if (abandoned) {
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: abandoned.id },
      data: {
        status: "failed",
        failedAt: now,
        failureCode: "abandoned_timeout",
      },
    })
  }
  // Failed/cancelled provisional evidence is no longer a serving source. Clear
  // it in bounded pages, while preserving compact paid-call receipts until the
  // terminal generation itself reaches its retention horizon.
  const [diagnostic] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT g.id FROM recommendation_precomputed_generation g
    WHERE g.status IN ('failed', 'cancelled')
      AND (
        EXISTS (SELECT 1 FROM recommendation_precomputed_build_choice c
                WHERE c.generation_id = g.id)
        OR EXISTS (SELECT 1 FROM recommendation_precomputed_build_source s
                   WHERE s.generation_id = g.id AND
                     (s.checkpoint <> '{}'::jsonb OR s.state IN ('pending', 'claimed')))
      )
    ORDER BY COALESCE(g.failed_at, g.cancelled_at), g.id
    LIMIT 1 FOR UPDATE OF g SKIP LOCKED
  `)
  const provisionalChoicesPruned = diagnostic
    ? await tx.$executeRaw(Prisma.sql`
        DELETE FROM recommendation_precomputed_build_choice c
        WHERE c.ctid IN (
          SELECT choice.ctid FROM recommendation_precomputed_build_choice choice
          WHERE choice.generation_id = ${diagnostic.id}
          ORDER BY choice.source_video_id, choice.target_video_id
          LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
        )
      `)
    : 0
  const checkpointsCleared = diagnostic
    ? await tx.$executeRaw(Prisma.sql`
        UPDATE recommendation_precomputed_build_source s
        SET checkpoint = '{}'::jsonb, checkpoint_id = NULL,
            checkpoint_digest = NULL,
            state = CASE WHEN s.state IN ('pending', 'claimed') THEN 'failed' ELSE s.state END,
            failure_code = CASE WHEN s.state IN ('pending', 'claimed') THEN 'terminal_generation' ELSE s.failure_code END,
            lease_token = NULL, lease_expires_at = NULL,
            completed_at = COALESCE(s.completed_at, ${now})
        WHERE s.ctid IN (
          SELECT source.ctid FROM recommendation_precomputed_build_source source
          WHERE source.generation_id = ${diagnostic.id}
            AND (source.checkpoint <> '{}'::jsonb OR source.state IN ('pending', 'claimed'))
          ORDER BY source.source_video_id
          LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
        )
      `)
    : 0
  const [candidate] = await tx.$queryRaw<
    Array<{
      id: string
      status: string
      protocol_version: number
      input_cutoff: Date
      input_digest: string
      input_mode: string
      historical_qualification: unknown
    }>
  >(Prisma.sql`
    SELECT g.id, g.status, g.protocol_version, g.input_cutoff,
           g.input_digest, g.input_mode, g.historical_qualification
    FROM recommendation_precomputed_generation g
    WHERE (g.status = 'retiring' OR
      (g.status IN ('complete', 'failed', 'cancelled')
        AND COALESCE(g.completed_at, g.failed_at, g.cancelled_at) <= ${cutoff}))
      AND NOT g.rollback_retention_hold
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_experiment e
        WHERE e.generation_id = g.id
      )
      AND (g.status <> 'complete' OR g.id NOT IN (
        SELECT newest.id FROM recommendation_precomputed_generation newest
        WHERE newest.status = 'complete'
        ORDER BY newest.completed_at DESC, newest.id DESC
        LIMIT 2
      ))
    ORDER BY CASE WHEN g.status = 'retiring' THEN 0 ELSE 1 END,
      COALESCE(g.completed_at, g.failed_at, g.cancelled_at), g.id
    LIMIT 1
    FOR UPDATE OF g SKIP LOCKED
  `)
  if (!candidate)
    return {
      generationsAbandoned: abandoned ? 1 : 0,
      generationsRetiring: 0,
      generationsDeleted: 0,
      finalSourcesDeleted: 0,
      buildSourcesDeleted: 0,
      provisionalChoicesDeleted: 0,
      modelCallsDeleted: 0,
      profileCallsDeleted: 0,
      profilesDeleted: 0,
      edgeBatchMembersDeleted: 0,
      edgeBatchCallsDeleted: 0,
      executionAttemptsDeleted: 0,
      historyCallsDeleted: 0,
      provisionalChoicesPruned,
      checkpointsCleared,
      proofsDeleted,
      pageFull: Boolean(
        abandoned ||
        diagnostic ||
        proofsDeleted === PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE,
      ),
    }
  // The NOT EXISTS predicate in the candidate scan can be evaluated before
  // waiting for a row lock held by a concurrent experiment configuration.
  // Recheck the pin under the acquired generation lock before draining rows.
  const [current, experimentPins] = await Promise.all([
    tx.recommendationPrecomputedGeneration.findUnique({
      where: { id: candidate.id },
      select: { rollbackRetentionHold: true },
    }),
    tx.recommendationPrecomputedExperiment.count({
      where: { generationId: candidate.id },
    }),
  ])
  if (!current || current.rollbackRetentionHold || experimentPins > 0)
    return {
      generationsAbandoned: abandoned ? 1 : 0,
      generationsRetiring: 0,
      generationsDeleted: 0,
      finalSourcesDeleted: 0,
      buildSourcesDeleted: 0,
      provisionalChoicesDeleted: 0,
      modelCallsDeleted: 0,
      profileCallsDeleted: 0,
      profilesDeleted: 0,
      edgeBatchMembersDeleted: 0,
      edgeBatchCallsDeleted: 0,
      executionAttemptsDeleted: 0,
      historyCallsDeleted: 0,
      provisionalChoicesPruned,
      checkpointsCleared,
      proofsDeleted,
      pageFull: true,
    }
  if (candidate.status !== "retiring")
    await tx.recommendationPrecomputedGeneration.update({
      where: { id: candidate.id },
      data: { status: "retiring", retiringAt: now },
    })
  const provisionalChoicesDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_build_choice c WHERE c.ctid IN (
      SELECT choice.ctid FROM recommendation_precomputed_build_choice choice
      WHERE choice.generation_id = ${candidate.id}
      ORDER BY choice.source_video_id, choice.target_video_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const finalSourcesDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_source s WHERE s.ctid IN (
      SELECT source.ctid FROM recommendation_precomputed_source source
      WHERE source.generation_id = ${candidate.id}
      ORDER BY source.source_video_id LIMIT ${SOURCE_PAGE_SIZE}
    )
  `)
  const modelCallsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_model_call c WHERE c.ctid IN (
      SELECT call.ctid FROM recommendation_precomputed_model_call call
      WHERE call.generation_id = ${candidate.id}
      ORDER BY call.call_id LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const edgeBatchMembersDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_edge_batch_member m WHERE m.ctid IN (
      SELECT member.ctid FROM recommendation_precomputed_edge_batch_member member
      WHERE member.generation_id = ${candidate.id}
      ORDER BY member.call_id, member.source_video_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const edgeBatchCallsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_edge_batch_call c WHERE c.ctid IN (
      SELECT call.ctid FROM recommendation_precomputed_edge_batch_call call
      WHERE call.generation_id = ${candidate.id}
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_edge_batch_member member
          WHERE member.generation_id = call.generation_id
            AND member.call_id = call.call_id
        )
      ORDER BY call.started_at, call.call_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const profileCallsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_profile_call c WHERE c.ctid IN (
      SELECT call.ctid FROM recommendation_precomputed_profile_call call
      WHERE call.generation_id = ${candidate.id}
      ORDER BY call.started_at, call.call_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const profilesDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_content_profile p WHERE p.ctid IN (
      SELECT profile.ctid FROM recommendation_precomputed_content_profile profile
      WHERE profile.generation_id = ${candidate.id}
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_profile_call call
          WHERE call.generation_id = profile.generation_id
            AND call.cache_key = profile.cache_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_edge_batch_member member
          WHERE member.generation_id = profile.generation_id
            AND member.source_profile_key = profile.cache_key
        )
      ORDER BY profile.cache_key
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const executionAttemptsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_execution_attempt a WHERE a.ctid IN (
      SELECT attempt.ctid FROM recommendation_precomputed_execution_attempt attempt
      WHERE attempt.generation_id = ${candidate.id}
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_model_call call
          WHERE call.generation_id = attempt.generation_id
            AND call.attempt_id = attempt.attempt_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_profile_call call
          WHERE call.generation_id = attempt.generation_id
            AND call.attempt_id = attempt.attempt_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM recommendation_precomputed_edge_batch_call call
          WHERE call.generation_id = attempt.generation_id
            AND call.attempt_id = attempt.attempt_id
        )
      ORDER BY attempt.started_at, attempt.attempt_id
      LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const historyCallsDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_history_call c WHERE c.ctid IN (
      SELECT call.ctid FROM recommendation_precomputed_history_call call
      WHERE call.generation_id = ${candidate.id}
      ORDER BY call.call_id LIMIT ${PRECOMPUTED_RETENTION_CHILD_PAGE_SIZE}
    )
  `)
  const buildSourcesDeleted = await tx.$executeRaw(Prisma.sql`
    DELETE FROM recommendation_precomputed_build_source s WHERE s.ctid IN (
      SELECT source.ctid FROM recommendation_precomputed_build_source source
      WHERE source.generation_id = ${candidate.id}
        AND NOT EXISTS (SELECT 1 FROM recommendation_precomputed_build_choice choice
                        WHERE choice.generation_id = source.generation_id
                          AND choice.source_video_id = source.source_video_id)
        AND NOT EXISTS (SELECT 1 FROM recommendation_precomputed_content_profile profile
                        WHERE profile.generation_id = source.generation_id
                          AND profile.video_id = source.source_video_id)
        AND NOT EXISTS (SELECT 1 FROM recommendation_precomputed_edge_batch_member member
                        WHERE member.generation_id = source.generation_id
                          AND member.source_video_id = source.source_video_id)
      ORDER BY source.source_video_id LIMIT ${SOURCE_PAGE_SIZE}
    )
  `)
  await tx.recommendationPrecomputedBuildBudget.deleteMany({
    where: { generationId: candidate.id },
  })
  const [remaining] = await tx.$queryRaw<
    Array<{ has_children: boolean }>
  >(Prisma.sql`
    SELECT
      EXISTS (SELECT 1 FROM recommendation_precomputed_source WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_build_source WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_build_choice WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_model_call WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_content_profile WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_profile_call WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_edge_batch_call WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_edge_batch_member WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_execution_attempt WHERE generation_id = ${candidate.id}) OR
      EXISTS (SELECT 1 FROM recommendation_precomputed_history_call WHERE generation_id = ${candidate.id})
      AS has_children
  `)
  const boundCapture = gaCaptureSnapshotRefSchema.safeParse(
    (candidate.historical_qualification as { snapshotRef?: unknown } | null)
      ?.snapshotRef,
  )
  if (!remaining?.has_children)
    await tx.recommendationPrecomputedGenerationRetentionProof.create({
      data: {
        generationId: candidate.id,
        generationProtocolVersion: candidate.protocol_version,
        inputCutoff: candidate.input_cutoff,
        inputDigest: candidate.input_digest,
        inputMode: candidate.input_mode,
        snapshotSha256: boundCapture.success
          ? boundCapture.data.artifactSha256
          : null,
        state: "retired",
        recordedAt: now,
        expiresAt: new Date(
          now.getTime() + PRECOMPUTED_RETENTION_PROOF_DAYS * 86_400_000,
        ),
      },
    })
  const removed = !remaining?.has_children
    ? await tx.recommendationPrecomputedGeneration.deleteMany({
        where: {
          id: candidate.id,
          status: "retiring",
          rollbackRetentionHold: false,
          privateExperiments: { none: {} },
        },
      })
    : { count: 0 }
  if (!remaining?.has_children && removed.count !== 1)
    throw new Error("precomputed_generation_purge_changed_under_lock")
  return {
    generationsAbandoned: abandoned ? 1 : 0,
    generationsRetiring: candidate.status === "retiring" ? 0 : 1,
    generationsDeleted: removed.count,
    finalSourcesDeleted,
    buildSourcesDeleted,
    provisionalChoicesDeleted,
    modelCallsDeleted,
    profileCallsDeleted,
    profilesDeleted,
    edgeBatchMembersDeleted,
    edgeBatchCallsDeleted,
    executionAttemptsDeleted,
    historyCallsDeleted,
    provisionalChoicesPruned,
    checkpointsCleared,
    proofsDeleted,
    // A processed generation does not prove that no other terminal generation
    // is waiting. Schedule a follow-up page; the empty page ends continuation.
    pageFull: true,
  }
}

/** Retryable post-commit object cleanup. Objects remain while their generation
 * can resume or is protected by the ordinary retention rules. The 30-minute
 * grace also fences an upload that began just before retirement committed. */
export async function purgeRetiredGaCaptureArtifacts(
  prisma: PrismaClient,
  now: Date,
  limit = 10,
  store?: GaCaptureStore,
): Promise<{ deleted: number; bytes: bigint }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RecommendationInputError(
      "precomputed_ga_capture_purge_invalid_limit",
    )
  const cutoff = new Date(now.getTime() - 30 * 60_000)
  const candidates = await prisma.$queryRaw<
    Array<{
      generation_id: string
      artifact_sha256: string
      storage_key: string
      artifact_bytes: bigint
    }>
  >(Prisma.sql`
    SELECT artifact.generation_id, artifact.artifact_sha256,
           artifact.storage_key, artifact.artifact_bytes
    FROM recommendation_precomputed_ga_capture_artifact artifact
    JOIN recommendation_precomputed_generation_retention_proof proof
      ON proof.generation_id = artifact.generation_id
    WHERE artifact.created_at <= ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_generation generation
        WHERE generation.id = artifact.generation_id
      )
    ORDER BY artifact.created_at, artifact.generation_id, artifact.artifact_sha256
    LIMIT ${limit}
  `)
  if (candidates.length === 0) return { deleted: 0, bytes: 0n }
  const objectStore = store ?? configuredGaCaptureStore()
  let deleted = 0
  let bytes = 0n
  for (const candidate of candidates) {
    if (
      candidate.storage_key !==
      gaCaptureStorageKey(candidate.generation_id, candidate.artifact_sha256)
    )
      throw new RecommendationInternalStateError(
        "precomputed_ga_capture_cleanup_identity_mismatch",
      )
    await objectStore.delete(candidate.storage_key)
    const removed = await prisma.$transaction(async (tx) => {
      const count =
        await tx.recommendationPrecomputedGaCaptureArtifact.deleteMany({
          where: {
            generationId: candidate.generation_id,
            artifactSha256: candidate.artifact_sha256,
            storageKey: candidate.storage_key,
          },
        })
      if (
        !(await tx.recommendationPrecomputedGaCaptureArtifact.count({
          where: { generationId: candidate.generation_id },
        }))
      )
        await tx.recommendationPrecomputedGenerationRetentionProof.updateMany({
          where: {
            generationId: candidate.generation_id,
            snapshotSha256: { not: null },
            artifactDeletedAt: null,
          },
          data: { artifactDeletedAt: now },
        })
      return count.count
    })
    deleted += removed
    if (removed) bytes += candidate.artifact_bytes
  }
  return { deleted, bytes }
}
