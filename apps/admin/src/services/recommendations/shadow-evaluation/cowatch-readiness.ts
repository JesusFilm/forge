import { Prisma, type PrismaClient } from "@prisma/client"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_SHADOW_GENERATOR_KEY,
} from "../cowatch/graph"
import { loadCowatchInspection } from "../cowatch/inspection.service"
import { COWATCH_SOURCE_WINDOW_VERSION } from "../cowatch/source-window"
import { RecommendationInternalStateError } from "../errors"
import {
  COWATCH_MMR_SHADOW_SAMPLING_VERSION,
  COWATCH_MMR_TRIAL_MANIFEST_ID,
  isExactCowatchMmrTrialManifest,
} from "../promotion/manifest"

type BoundEvaluation = {
  id: string
  manifestId: string
  generatorVersion: string
  cowatchGenerationId: string | null
  requestedSampleSize: number
  samplingVersion: string
}

/** Structural readiness for one controlled trial, never efficacy or live authority. */
export async function validateCowatchTrialProtocol(
  tx: Prisma.TransactionClient,
  evaluation: BoundEvaluation,
  now: Date,
): Promise<string | null> {
  if (
    evaluation.manifestId !== COWATCH_MMR_TRIAL_MANIFEST_ID ||
    evaluation.generatorVersion !== COWATCH_SHADOW_GENERATOR_KEY ||
    evaluation.samplingVersion !== COWATCH_MMR_SHADOW_SAMPLING_VERSION ||
    !/^[a-f0-9]{64}$/.test(evaluation.cowatchGenerationId ?? "") ||
    evaluation.requestedSampleSize > 500
  )
    return "cowatch_trial_contract_invalid"
  const [manifest, protocol] = await Promise.all([
    tx.recommendationStrategyManifest.findUnique({
      where: { id: evaluation.manifestId },
    }),
    tx.recommendationCompositionProtocol.findUnique({
      where: { shadowEvaluationId: evaluation.id },
    }),
  ])
  const config = protocol?.config
  if (!manifest || !isExactCowatchMmrTrialManifest(manifest))
    return "cowatch_trial_manifest_invalid"
  if (
    !protocol ||
    protocol.revokedAt ||
    protocol.expiresAt <= now ||
    protocol.sourceManifestId !== evaluation.manifestId ||
    protocol.challengerManifestId !== evaluation.manifestId ||
    protocol.generatorVersion !== evaluation.generatorVersion ||
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    config.cowatchGenerationId !== evaluation.cowatchGenerationId
  )
    return "cowatch_trial_protocol_invalid"
  return null
}

export async function requireCowatchShadowBinding(
  tx: Prisma.TransactionClient,
  evaluation: BoundEvaluation,
  now: Date,
) {
  const cowatch = evaluation.generatorVersion === COWATCH_SHADOW_GENERATOR_KEY
  if (!cowatch) {
    if (
      evaluation.cowatchGenerationId !== null ||
      evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID
    )
      throw new RecommendationInternalStateError(
        "shadow_graph_binding_incompatible",
      )
    return
  }
  if (!/^[a-f0-9]{64}$/.test(evaluation.cowatchGenerationId ?? ""))
    throw new RecommendationInternalStateError("shadow_graph_binding_required")
  const graph = await tx.recommendationCowatchGeneration.findUnique({
    where: { id: evaluation.cowatchGenerationId! },
  })
  if (!graph || graph.invalidatedAt || graph.expiresAt <= now)
    throw new RecommendationInternalStateError("shadow_graph_unavailable")
  if (evaluation.manifestId === COWATCH_MMR_TRIAL_MANIFEST_ID) {
    const reason = await validateCowatchTrialProtocol(tx, evaluation, now)
    if (reason) throw new RecommendationInternalStateError(reason)
  }
}

export async function cowatchTrialCandidateReadiness(
  tx: Prisma.TransactionClient,
  evaluation: BoundEvaluation,
  now: Date,
): Promise<string | null> {
  // Match source writers' graph -> protocol order. A request/run deletion
  // revokes this protocol, so its SHARE lock orders that deletion before or
  // after publication instead of letting a stale cohort snapshot approve it.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM recommendation_cowatch_generation
    WHERE id = ${evaluation.cowatchGenerationId} FOR SHARE`)
  await tx.$queryRaw(Prisma.sql`
    SELECT protocol.id FROM recommendation_composition_protocol protocol
    JOIN recommendation_strategy_manifest manifest ON manifest.id = protocol.challenger_manifest_id
    WHERE protocol.shadow_evaluation_id = ${evaluation.id}
    FOR SHARE OF protocol, manifest
  `)
  const protocolFailure = await validateCowatchTrialProtocol(
    tx,
    evaluation,
    now,
  )
  if (protocolFailure) return protocolFailure
  const [cohort] = await tx.$queryRaw<
    Array<{
      sampledAt: Date | null
      sampledCount: number
      retainedCount: bigint
    }>
  >(Prisma.sql`
    SELECT evaluation.sampled_at AS "sampledAt", evaluation.sampled_count AS "sampledCount",
      count(run.id)::bigint AS "retainedCount"
    FROM recommendation_shadow_evaluation evaluation
    LEFT JOIN recommendation_shadow_run run ON run.evaluation_id = evaluation.id
    WHERE evaluation.id = ${evaluation.id}
    GROUP BY evaluation.id
  `)
  if (
    !cohort?.sampledAt ||
    cohort.retainedCount !== BigInt(cohort.sampledCount)
  )
    return "cowatch_trial_sample_retention_incomplete"
  const graph = await tx.recommendationCowatchGeneration.findUnique({
    where: { id: evaluation.cowatchGenerationId! },
  })
  if (
    !graph ||
    graph.lineageVersion !== COWATCH_DURABLE_LINEAGE_VERSION ||
    graph.sourceWindowVersion !== COWATCH_SOURCE_WINDOW_VERSION ||
    graph.edgeCount === 0
  )
    return "cowatch_trial_graph_incompatible"
  // Inspection performs bounded full source validation at operator time. This
  // transaction has a deadline; serving uses the indexed revocation latch.
  const inspection = await loadCowatchInspection(tx as PrismaClient, {
    generationId: graph.id,
    now,
  })
  if (inspection.state !== "current") return "cowatch_trial_graph_not_current"
  const [evidence] = await tx.$queryRaw<
    Array<{ invalid: bigint; mismatched: bigint; eligible: bigint }>
  >(Prisma.sql`
    SELECT
      (SELECT count(*) FROM recommendation_shadow_run run
        JOIN recommendation_request request ON request.id = run.request_id
        LEFT JOIN recommendation_profile profile ON profile.id = run.projection_profile_id
        LEFT JOIN recommendation_profile_projection_generation projection ON projection.id = run.context_projection_ref
        WHERE run.evaluation_id = ${evaluation.id} AND (
          run.state <> 'published' OR run.failure_reason IS NOT NULL OR run.expires_at <= ${now}
          OR request.state <> 'issued' OR request.expires_at <= ${now}
          OR profile.id IS NULL OR profile.state <> 'active' OR profile.expires_at <= ${now}
          OR profile.privacy_generation IS DISTINCT FROM run.privacy_generation
          OR projection.id IS NULL OR projection.state <> 'published' OR projection.expires_at <= ${now}
          OR projection.profile_id IS DISTINCT FROM profile.id
          OR projection.privacy_generation IS DISTINCT FROM run.privacy_generation
          OR projection.input_digest IS DISTINCT FROM run.context_projection_digest
        ))::bigint AS invalid,
      count(*) FILTER (WHERE nomination.provenance->>'generation' IS DISTINCT FROM ${evaluation.cowatchGenerationId})::bigint AS mismatched,
      count(*) FILTER (WHERE nomination.eligible AND nomination.expires_at > ${now})::bigint AS eligible
    FROM recommendation_shadow_nomination nomination
    JOIN recommendation_shadow_run run ON run.id = nomination.run_id
    WHERE run.evaluation_id = ${evaluation.id} AND nomination.generator = 'directional-cowatch'
  `)
  if (!evidence || evidence.invalid > 0n || evidence.mismatched > 0n)
    return "cowatch_trial_source_evidence_incomplete"
  if (evidence.eligible === 0n) return "cowatch_trial_no_eligible_nominations"
  return null
}
