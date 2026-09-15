import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma as defaultPrisma } from "@/db/client"
import { createRecommendationIntegrityService } from "../integrity.service"
import {
  dispatchRecommendationProfileProjection,
  RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS,
  RECOMMENDATION_PROFILE_RECONCILIATION_BATCH_SIZE,
  redispatchRecommendationProfileProjectionRun,
} from "./job"
import { profileLineageEligibleSql } from "./profile-lineage"

export type RecommendationProfileReconciliationResult = Readonly<{
  locked: boolean
  affectedPointers: number
  classificationsAttempted: number
  classificationsFailed: number
  rebuildsQueued: number
  staleRuns: number
  staleRunsQueued: number
  attemptsExhausted: number
  dispatchFailures: number
}>

type ReconciliationDependencies = Readonly<{
  prisma: PrismaClient
  classifyOutcome: (id: string) => Promise<unknown>
  classifySelection: (id: string) => Promise<unknown>
  dispatchProjection: typeof dispatchRecommendationProfileProjection
  redispatchRun: typeof redispatchRecommendationProfileProjectionRun
}>

type AffectedPointer = Readonly<{
  scope: "durable" | "session"
  profileId: string | null
  privacyGeneration: number | null
  sessionDigest: string | null
  generationId: string
  pointerGeneration: number
}>

type StaleRun = Readonly<{ id: string; generation: number }>
type Source = Readonly<{
  sourceType: "playback_outcome" | "selection"
  sourceId: string
}>

export async function runRecommendationProfileReconciliationBatch(
  overrides: Partial<ReconciliationDependencies> = {},
  now = new Date(),
): Promise<RecommendationProfileReconciliationResult> {
  const db = overrides.prisma ?? defaultPrisma
  const integrity = createRecommendationIntegrityService(db)
  const deps: ReconciliationDependencies = {
    prisma: db,
    classifyOutcome: (id) => integrity.classifyPlaybackOutcome(id),
    classifySelection: (id) => integrity.classifySelection(id),
    dispatchProjection: dispatchRecommendationProfileProjection,
    redispatchRun: redispatchRecommendationProfileProjectionRun,
    ...overrides,
  }

  const discovered = await deps.prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(
        hashtextextended('recommendation-profile-reconciliation', 459)
      ) AS acquired
    `)
    if (lock[0]?.acquired !== true) return null

    const attemptsExhausted = await tx.$executeRaw(Prisma.sql`
      UPDATE recommendation_profile_projection_run
      SET state = 'failed',
          failure_reason = 'projection_attempts_exhausted',
          last_transition_reason = 'projection_attempts_exhausted',
          completed_at = ${now},
          claim_id = NULL,
          lease_expires_at = NULL
      WHERE state IN ('pending', 'claimed')
        AND attempt_count >= ${RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS}
        AND (state = 'pending' OR lease_expires_at <= ${now})
    `)

    const staleRuns = await tx.$queryRaw<StaleRun[]>(Prisma.sql`
      SELECT id, generation
      FROM recommendation_profile_projection_run
      WHERE expires_at > ${now}
        AND attempt_count < ${RECOMMENDATION_PROFILE_PROJECTION_MAX_ATTEMPTS}
        AND (
          (state = 'pending' AND (
            workflow_run_id IS NULL OR last_transition_reason IS NOT NULL
          ))
          OR (state = 'claimed' AND lease_expires_at <= ${now})
        )
      ORDER BY COALESCE(lease_expires_at, created_at), id
      LIMIT ${RECOMMENDATION_PROFILE_RECONCILIATION_BATCH_SIZE}
    `)

    const affectedPointers = await tx.$queryRaw<AffectedPointer[]>(Prisma.sql`
      SELECT
        pointer.scope::text AS scope,
        pointer.profile_id AS "profileId",
        pointer.privacy_generation AS "privacyGeneration",
        COALESCE(pointer.session_digest, active_link.session_digest)
          AS "sessionDigest",
        pointer.generation_id AS "generationId",
        pointer.pointer_generation AS "pointerGeneration"
      FROM recommendation_profile_projection_pointer pointer
      JOIN recommendation_profile_projection_generation generation
        ON generation.id = pointer.generation_id
      LEFT JOIN LATERAL (
        SELECT link.session_digest
        FROM recommendation_profile_session_link link
        WHERE link.profile_id = pointer.profile_id
          AND link.privacy_generation = pointer.privacy_generation
          AND link.expires_at > ${now}
        ORDER BY link.linked_at DESC, link.id
        LIMIT 1
      ) active_link ON true
      WHERE generation.state = 'published'
        AND generation.expires_at > ${now}
        AND NOT ${profileLineageEligibleSql(Prisma.sql`generation.id`, now)}
        AND NOT EXISTS (
          SELECT 1
          FROM recommendation_profile_projection_run active_run
          WHERE active_run.state IN ('pending', 'claimed')
            AND active_run.expected_generation_id = pointer.generation_id
            AND active_run.expected_pointer_generation = pointer.pointer_generation
        )
      ORDER BY pointer.updated_at, pointer.scope_digest
      LIMIT ${RECOMMENDATION_PROFILE_RECONCILIATION_BATCH_SIZE}
    `)

    const generationIds = affectedPointers.map((row) => row.generationId)
    const sources =
      generationIds.length === 0
        ? []
        : await tx.$queryRaw<Source[]>(Prisma.sql`
            SELECT DISTINCT ON (source_type, source_id)
              source_type AS "sourceType", source_id AS "sourceId"
            FROM (
              SELECT
                'playback_outcome'::text AS source_type,
                contribution.source_outcome_id AS source_id
              FROM recommendation_profile_projection_contribution contribution
              WHERE contribution.generation_id IN (${Prisma.join(generationIds)})
                AND contribution.source_outcome_id IS NOT NULL
              UNION ALL
              SELECT
                'selection'::text AS source_type,
                contribution.source_selection_id AS source_id
              FROM recommendation_profile_projection_contribution contribution
              WHERE contribution.generation_id IN (${Prisma.join(generationIds)})
                AND contribution.source_selection_id IS NOT NULL
            ) source
            WHERE source_id IS NOT NULL
            ORDER BY source_type, source_id
            LIMIT 256
          `)

    return { attemptsExhausted, staleRuns, affectedPointers, sources }
  })

  if (!discovered) {
    return {
      locked: true,
      affectedPointers: 0,
      classificationsAttempted: 0,
      classificationsFailed: 0,
      rebuildsQueued: 0,
      staleRuns: 0,
      staleRunsQueued: 0,
      attemptsExhausted: 0,
      dispatchFailures: 0,
    }
  }

  let classificationsFailed = 0
  for (const source of discovered.sources) {
    try {
      if (source.sourceType === "selection") {
        await deps.classifySelection(source.sourceId)
      } else {
        await deps.classifyOutcome(source.sourceId)
      }
    } catch {
      classificationsFailed += 1
    }
  }

  let rebuildsQueued = 0
  let staleRunsQueued = 0
  let dispatchFailures = 0
  for (const pointer of discovered.affectedPointers) {
    try {
      await deps.dispatchProjection({
        sessionDigest: pointer.sessionDigest,
        profileId: pointer.profileId,
        privacyGeneration: pointer.privacyGeneration,
        now,
        evidenceWatermark: now,
        reconciliationCause: "eligibility_revision",
      })
      rebuildsQueued += 1
    } catch {
      dispatchFailures += 1
    }
  }
  for (const run of discovered.staleRuns) {
    try {
      const queued = await deps.redispatchRun({
        runId: run.id,
        expectedGeneration: run.generation,
        now,
      })
      if (queued) staleRunsQueued += 1
    } catch {
      dispatchFailures += 1
    }
  }

  return {
    locked: false,
    affectedPointers: discovered.affectedPointers.length,
    classificationsAttempted: discovered.sources.length,
    classificationsFailed,
    rebuildsQueued,
    staleRuns: discovered.staleRuns.length,
    staleRunsQueued,
    attemptsExhausted: discovered.attemptsExhausted,
    dispatchFailures,
  }
}
