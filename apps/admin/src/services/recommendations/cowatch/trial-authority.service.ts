import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
  COWATCH_SHADOW_GENERATOR_KEY,
} from "./graph"
import { recommendationManifestDigest } from "../promotion/manifest"
import { cowatchSourceInvalidSql } from "./lineage"
import {
  COWATCH_SOURCE_WINDOW_VERSION,
  type CowatchSourceWindow,
} from "./source-window"

export const COWATCH_FROZEN_TRIAL_MODE =
  "frozen-source-controlled-trial-v1" as const
const DAY_MS = 86_400_000

/** Resolved by the server study registry, never supplied as a caller opt-in. */
export type CowatchTrialBinding = Readonly<{
  mode: typeof COWATCH_FROZEN_TRIAL_MODE
  studyId: string
  experimentGeneration: number
  protocolDigest: string
  manifestId: string
  manifestDigest: string
  graphGenerationId: string
  sourceWindow: CowatchSourceWindow
  calibrationCompletedAt: Date
  enrollmentEnd: Date
  trialValidUntil: Date
  shadowEvaluationId: string
  shadowDecisionId: string
}>

export function cowatchTrialBindingRecord(binding: CowatchTrialBinding) {
  return {
    mode: binding.mode,
    studyId: binding.studyId,
    experimentGeneration: binding.experimentGeneration,
    protocolDigest: binding.protocolDigest,
    manifestId: binding.manifestId,
    manifestDigest: binding.manifestDigest,
    graphGenerationId: binding.graphGenerationId,
    sourceWindow: {
      version: binding.sourceWindow.version,
      windowStart: binding.sourceWindow.windowStart.toISOString(),
      windowEnd: binding.sourceWindow.windowEnd.toISOString(),
      evaluationAsOf: binding.sourceWindow.evaluationAsOf.toISOString(),
    },
    calibrationCompletedAt: binding.calibrationCompletedAt.toISOString(),
    enrollmentEnd: binding.enrollmentEnd.toISOString(),
    trialValidUntil: binding.trialValidUntil.toISOString(),
    shadowEvaluationId: binding.shadowEvaluationId,
    shadowDecisionId: binding.shadowDecisionId,
  }
}
export function cowatchTrialBindingDigest(
  binding: CowatchTrialBinding,
): string {
  return createHash("sha256")
    .update(JSON.stringify(cowatchTrialBindingRecord(binding)))
    .digest("hex")
}

export type CowatchTrialRefusal =
  | "cowatch_binding_invalid"
  | "cowatch_generation_unavailable"
  | "cowatch_generation_invalidated"
  | "cowatch_generation_stale"
  | "cowatch_lineage_invalid"
  | "cowatch_dependency_expiry_insufficient"
  | "cowatch_shadow_evidence_invalid"
  | "cowatch_supported_edges_sparse"
  | "cowatch_authority_mismatch"
  | "cowatch_authority_unqualified"
  | "cowatch_trial_expired"

function validBinding(binding: CowatchTrialBinding, now: Date): boolean {
  return (
    binding.mode === COWATCH_FROZEN_TRIAL_MODE &&
    [
      binding.protocolDigest,
      binding.manifestDigest,
      binding.graphGenerationId,
    ].every((value) => /^[a-f0-9]{64}$/.test(value)) &&
    [
      binding.studyId,
      binding.manifestId,
      binding.shadowEvaluationId,
      binding.shadowDecisionId,
    ].every((value) => value.length > 0 && value.length <= 191) &&
    Number.isSafeInteger(binding.experimentGeneration) &&
    binding.experimentGeneration > 0 &&
    binding.sourceWindow.version === COWATCH_SOURCE_WINDOW_VERSION &&
    binding.sourceWindow.windowStart < binding.sourceWindow.windowEnd &&
    binding.sourceWindow.windowEnd <= binding.sourceWindow.evaluationAsOf &&
    binding.sourceWindow.evaluationAsOf <= now &&
    binding.calibrationCompletedAt <= now &&
    binding.trialValidUntil > now &&
    binding.trialValidUntil.getTime() ===
      binding.enrollmentEnd.getTime() + 30 * 60 * 60 * 1_000
  )
}

/** Full validation occurs once, under the same graph lock used by invalidators.
 * READ COMMITTED is deliberate: after acquiring a previously held graph lock,
 * validation must see the dependency mutation that just committed.
 */
export async function qualifyCowatchTrialAuthority(
  prisma: PrismaClient,
  binding: CowatchTrialBinding,
  now = new Date(),
) {
  const refuse = (reason: CowatchTrialRefusal) => ({
    status: "refused" as const,
    reason,
  })
  if (!validBinding(binding, now)) return refuse("cowatch_binding_invalid")
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
      await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${binding.graphGenerationId} FOR UPDATE`
      // Legacy rollback owns the pointer before slate-fence triggers acquire
      // graph locks. Refuse qualification immediately so rollback can proceed.
      await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = 'recommendation-promotion-pointer' FOR SHARE NOWAIT`
      const promotion = await tx.recommendationPromotionPointer.findUnique({
        where: { id: "recommendation-promotion-pointer" },
      })
      if (!promotion) return refuse("cowatch_authority_unqualified")
      const generation = await tx.recommendationCowatchGeneration.findUnique({
        where: { id: binding.graphGenerationId },
      })
      if (!generation) return refuse("cowatch_generation_unavailable")
      if (generation.invalidatedAt)
        return refuse("cowatch_generation_invalidated")
      if (
        generation.lineageVersion !== COWATCH_DURABLE_LINEAGE_VERSION ||
        generation.projectionVersion !== COWATCH_PROJECTION_VERSION ||
        generation.featureVersion !== COWATCH_FEATURE_VERSION ||
        generation.sourceWindowVersion !== binding.sourceWindow.version ||
        generation.windowStart?.getTime() !==
          binding.sourceWindow.windowStart.getTime() ||
        generation.windowEnd.getTime() !==
          binding.sourceWindow.windowEnd.getTime() ||
        generation.evaluationAsOf?.getTime() !==
          binding.sourceWindow.evaluationAsOf.getTime()
      )
        return refuse("cowatch_authority_mismatch")
      const bindingDigest = cowatchTrialBindingDigest(binding)
      const existing = await tx.recommendationCowatchTrialAuthority.findUnique({
        where: { generationId: generation.id },
      })
      if (existing?.revokedAt) return refuse("cowatch_generation_invalidated")
      if (
        existing &&
        existing.ownerInfluenceFloorGeneration !==
          promotion.ownerInfluenceFloorGeneration
      )
        return refuse("cowatch_authority_mismatch")
      if (existing)
        return existing.bindingDigest === bindingDigest
          ? { status: "unchanged" as const, authority: existing }
          : refuse("cowatch_authority_mismatch")
      if (
        generation.publishedAt > now ||
        now.getTime() - generation.publishedAt.getTime() > DAY_MS ||
        generation.publishedAt < binding.calibrationCompletedAt
      )
        return refuse("cowatch_generation_stale")
      const evidence = await tx.recommendationShadowEvaluation.findUnique({
        where: { id: binding.shadowEvaluationId },
        include: { decision: true, manifest: true },
      })
      if (
        !evidence ||
        evidence.cowatchGenerationId !== generation.id ||
        evidence.manifestId !== binding.manifestId ||
        recommendationManifestDigest(evidence.manifest) !==
          binding.manifestDigest ||
        evidence.generatorVersion !== COWATCH_SHADOW_GENERATOR_KEY ||
        evidence.state !== "TERMINAL" ||
        evidence.createdAt < generation.publishedAt ||
        evidence.createdAt > now ||
        evidence.decision?.id !== binding.shadowDecisionId ||
        evidence.decision.decision !== "PROMOTE_TO_EXPERIMENT" ||
        evidence.decision.decidedAt < evidence.createdAt ||
        evidence.decision.decidedAt > now ||
        now.getTime() - evidence.decision.decidedAt.getTime() > DAY_MS
      )
        return refuse("cowatch_shadow_evidence_invalid")
      const [source] = await tx.$queryRaw<
        Array<{
          count: bigint
          invalid: bigint
          earliest: Date | null
          rawPopulationExpiresAt: Date | null
        }>
      >(Prisma.sql`
      SELECT COUNT(*)::bigint AS count,
        COUNT(*) FILTER (WHERE ${cowatchSourceInvalidSql(now, generation.lineageVersion)})::bigint AS invalid,
        MIN(LEAST(source_row.expires_at, outcome.expires_at, episode.expires_at, decision.expires_at, profile.expires_at)) AS earliest,
        MAX(GREATEST(source_row.expires_at, outcome.expires_at, episode.expires_at)) AS "rawPopulationExpiresAt"
      FROM recommendation_cowatch_source_contribution source_row
      JOIN recommendation_outcome_revision outcome ON outcome.id = source_row.outcome_id
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      LEFT JOIN recommendation_profile profile ON profile.id = source_row.viewer_profile_id
      LEFT JOIN recommendation_eligibility_decision decision ON decision.id = source_row.eligibility_decision_id
      LEFT JOIN recommendation_cowatch_suppression suppression ON suppression.episode_id = episode.id
      WHERE source_row.generation_id = ${generation.id}
    `)
      const [pairs] = await tx.$queryRaw<
        Array<{ count: bigint; earliest: Date | null }>
      >`SELECT COUNT(*)::bigint AS count, MIN(expires_at) AS earliest FROM recommendation_cowatch_contribution WHERE generation_id = ${generation.id}`
      const [edges] = await tx.$queryRaw<
        Array<{ count: bigint; supported: bigint }>
      >`SELECT COUNT(*)::bigint AS count, COUNT(*) FILTER (WHERE eligible)::bigint AS supported FROM recommendation_cowatch_edge WHERE generation_id = ${generation.id}`
      if (
        !source ||
        Number(source.count) !== generation.sourceCount ||
        Number(source.invalid) !== 0 ||
        Number(pairs?.count) !== generation.contributionCount ||
        Number(edges?.count) !== generation.edgeCount
      )
        return refuse("cowatch_lineage_invalid")
      if (
        !source.earliest ||
        !pairs?.earliest ||
        Number(edges?.supported) === 0
      )
        return refuse("cowatch_supported_edges_sparse")
      const dependencyExpiresAt = new Date(
        Math.min(
          generation.expiresAt.getTime(),
          source.earliest.getTime(),
          pairs.earliest.getTime(),
          evidence.expiresAt.getTime(),
          evidence.decision.expiresAt.getTime(),
        ),
      )
      if (dependencyExpiresAt <= binding.trialValidUntil)
        return refuse("cowatch_dependency_expiry_insufficient")
      const authority = await tx.recommendationCowatchTrialAuthority.create({
        data: {
          generationId: generation.id,
          ownerInfluenceFloorGeneration:
            promotion.ownerInfluenceFloorGeneration,
          bindingDigest,
          binding: cowatchTrialBindingRecord(binding),
          dependencyExpiresAt,
          rawPopulationExpiresAt: source.rawPopulationExpiresAt!,
          trialValidUntil: binding.trialValidUntil,
          qualifiedAt: now,
        },
      })
      return { status: "qualified" as const, authority }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 1_000,
      timeout: 30_000,
    },
  )
}

/** Indexed lookup only: never scan raw sources in live delivery. */
export async function readCowatchTrialAuthority(
  db: Pick<
    Prisma.TransactionClient,
    | "recommendationCowatchTrialAuthority"
    | "recommendationCowatchGeneration"
    | "recommendationPromotionPointer"
  >,
  binding: CowatchTrialBinding,
  now: Date,
) {
  const refuse = (reason: CowatchTrialRefusal) => ({
    status: "refused" as const,
    reason,
  })
  if (!validBinding(binding, now))
    return refuse(
      binding.trialValidUntil <= now
        ? "cowatch_trial_expired"
        : "cowatch_binding_invalid",
    )
  const authority = await db.recommendationCowatchTrialAuthority.findUnique({
    where: { generationId: binding.graphGenerationId },
  })
  if (!authority) return refuse("cowatch_authority_unqualified")
  const promotion = await db.recommendationPromotionPointer.findUnique({
    where: { id: "recommendation-promotion-pointer" },
  })
  if (
    !promotion ||
    authority.ownerInfluenceFloorGeneration !==
      promotion.ownerInfluenceFloorGeneration
  )
    return refuse("cowatch_authority_mismatch")
  if (authority.bindingDigest !== cowatchTrialBindingDigest(binding))
    return refuse("cowatch_authority_mismatch")
  const generation = await db.recommendationCowatchGeneration.findUnique({
    where: { id: binding.graphGenerationId },
  })
  if (!generation) return refuse("cowatch_generation_unavailable")
  if (authority.revokedAt || generation.invalidatedAt)
    return refuse("cowatch_generation_invalidated")
  if (
    generation.expiresAt <= now ||
    authority.dependencyExpiresAt <= now ||
    authority.trialValidUntil <= now
  )
    return refuse("cowatch_trial_expired")
  return { status: "current" as const, authority: { ...authority, generation } }
}

/** Use inside the final issuance transaction: the shared graph lock prevents
 * a dependency writer from committing invalidation before issuance commits.
 * A later request observes the committed invalidation and falls back.
 */
export async function lockCowatchTrialAuthorityForIssuance(
  tx: Pick<
    Prisma.TransactionClient,
    | "$queryRaw"
    | "recommendationCowatchTrialAuthority"
    | "recommendationCowatchGeneration"
    | "recommendationPromotionPointer"
  >,
  binding: CowatchTrialBinding,
  now: Date,
) {
  await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${binding.graphGenerationId} FOR SHARE`
  return readCowatchTrialAuthority(tx, binding, now)
}

/** Bounded retention seam for the parent retention worker. No raw/source TTL changes. */
export async function purgeExpiredCowatchTrialAuthorities(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  now: Date,
): Promise<number> {
  return tx.$executeRaw`DELETE FROM recommendation_cowatch_trial_authority WHERE generation_id IN (
    SELECT generation_id FROM recommendation_cowatch_trial_authority WHERE raw_population_expires_at <= ${now}
    ORDER BY raw_population_expires_at, generation_id LIMIT 500 FOR UPDATE SKIP LOCKED
  )`
}
