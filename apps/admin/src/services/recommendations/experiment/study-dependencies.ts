import type { Prisma } from "@prisma/client"
import {
  isEquivalentSemanticChallenger,
  isExactHybridPersonalizedManifest,
  isExactIncumbentHybridManifest,
  isExactIncumbentHybridAaManifest,
  isExactCowatchMmrTrialManifest,
  recommendationManifestDigest,
  type PromotionManifest,
} from "../promotion/manifest"
import {
  cowatchTrialBindingDigest,
  readCowatchTrialAuthority,
  type CowatchTrialBinding,
} from "../cowatch/trial-authority.service"
import {
  resolveCompositionQualification,
  resolveRetainedCompositionQualification,
  lockCompositionQualificationForIssuance,
} from "../composition/service"
import { type StudyProtocol } from "./study-protocol"

export type StudyIdentity = {
  experimentId: string
  experimentGeneration: number
  protocolDigest: string
}

export function studyManifestPairIsExact(
  protocol: StudyProtocol,
  control: PromotionManifest,
  challenger: PromotionManifest,
) {
  if (
    !control.enabled ||
    !challenger.enabled ||
    recommendationManifestDigest(control) !== protocol.controlManifestDigest ||
    recommendationManifestDigest(challenger) !==
      protocol.challengerManifestDigest
  )
    return false
  switch (protocol.comparison) {
    case "incumbent-aa":
      return (
        isExactIncumbentHybridManifest(control) &&
        isExactIncumbentHybridAaManifest(challenger)
      )
    case "incumbent-cowatch-mmr":
      return (
        isExactIncumbentHybridManifest(control) &&
        isExactCowatchMmrTrialManifest(challenger)
      )
    case "semantic-aa":
      return isEquivalentSemanticChallenger(challenger)
    case "semantic-profile":
      return isExactHybridPersonalizedManifest(challenger)
  }
}

export function studyCowatchBinding(
  protocol: StudyProtocol,
  identity: StudyIdentity,
): CowatchTrialBinding | null {
  const graph = protocol.cowatch
  if (protocol.comparison !== "incumbent-cowatch-mmr" || !graph) return null
  return {
    mode: graph.mode,
    studyId: identity.experimentId,
    experimentGeneration: identity.experimentGeneration,
    protocolDigest: identity.protocolDigest,
    manifestId: protocol.challengerManifestId,
    manifestDigest: protocol.challengerManifestDigest,
    graphGenerationId: graph.graphGenerationId,
    sourceWindow: {
      version: graph.sourceWindow.version,
      windowStart: new Date(graph.sourceWindow.windowStart),
      windowEnd: new Date(graph.sourceWindow.windowEnd),
      evaluationAsOf: new Date(graph.sourceWindow.evaluationAsOf),
    },
    calibrationCompletedAt: new Date(graph.calibrationCompletedAt),
    enrollmentEnd: new Date(protocol.endsAt),
    trialValidUntil: new Date(graph.trialValidUntil),
    shadowEvaluationId: graph.shadowEvaluationId,
    shadowDecisionId: graph.shadowDecisionId,
  }
}

/** Point checks only. Source integrity was fully qualified before activation. */
export async function readStudyDependencies(
  tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
  now: Date,
) {
  const cowatch = studyCowatchBinding(protocol, identity)
  if (!cowatch)
    return {
      cowatch: null,
      composition: null,
      validUntil: new Date(protocol.expiresAt),
    }
  if (!protocol.composition) return null
  const graph = await readCowatchTrialAuthority(tx, cowatch, now)
  const composition = await resolveCompositionQualification(
    tx,
    protocol.composition,
    now,
  )
  const horizon = Date.parse(protocol.cowatch!.earliestDependencyExpiresAt)
  if (
    graph.status !== "current" ||
    !composition ||
    graph.authority.dependencyExpiresAt.getTime() < horizon ||
    composition.validUntil.getTime() < horizon
  )
    return null
  return {
    cowatch,
    composition: protocol.composition,
    validUntil: cowatch.trialValidUntil,
  }
}

/** Mature analysis examines retained trial coverage. Scheduled expiry at the
 * end of follow-up is normal; this helper grants no current serving authority. */
export async function studyDependencyInterruption(
  tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
) {
  const binding = studyCowatchBinding(protocol, identity)
  if (!binding) return null
  const horizon = binding.trialValidUntil
  const graph = await tx.recommendationCowatchTrialAuthority.findUnique({
    where: { generationId: binding.graphGenerationId },
  })
  if (
    !graph ||
    graph.bindingDigest !== cowatchTrialBindingDigest(binding) ||
    graph.dependencyExpiresAt <= horizon ||
    graph.trialValidUntil.getTime() !== horizon.getTime() ||
    graph.qualifiedAt > new Date(protocol.startsAt) ||
    (graph.revokedAt && graph.revokedAt <= horizon)
  )
    return "cowatch_source_interrupted"
  if (!protocol.composition)
    return "composition_retrospective_authority_unverifiable"
  // This constant lookup is intentionally conservative if composition was
  // revoked after the trial; normal validity expiry is evaluated at the horizon.
  const composition = await resolveRetainedCompositionQualification(
    tx,
    protocol.composition,
    horizon,
  )
  return composition && composition.validUntil >= horizon
    ? null
    : "composition_retrospective_authority_unverifiable"
}

/** Publication locks dependency writers before locking the study. Expiry is
 * assessed retrospectively below; acquiring locks never grants serving use. */
export async function lockStudyDependenciesForEvaluation(
  tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
  now: Date,
) {
  const binding = studyCowatchBinding(protocol, identity)
  if (!binding) return
  await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${binding.graphGenerationId} FOR SHARE`
  await tx.$queryRaw`SELECT generation_id FROM recommendation_cowatch_trial_authority WHERE generation_id = ${binding.graphGenerationId} FOR SHARE`
  if (protocol.composition)
    await lockCompositionQualificationForIssuance(tx, protocol.composition, now)
}
