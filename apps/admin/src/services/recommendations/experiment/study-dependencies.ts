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
import type { CowatchTrialBinding } from "../cowatch/trial-authority.service"
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
/** Semantic studies remain available; retired co-watch bindings fail closed. */
export async function readStudyDependencies(
  _tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
  _now: Date,
) {
  if (studyCowatchBinding(protocol, identity)) return null
  return {
    cowatch: null,
    composition: null,
    validUntil: new Date(protocol.expiresAt),
  }
}

export async function studyDependencyInterruption(
  _tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
): Promise<string | null> {
  return studyCowatchBinding(protocol, identity)
    ? "cowatch_source_interrupted"
    : null
}

export async function lockStudyDependenciesForEvaluation(
  _tx: Prisma.TransactionClient,
  protocol: StudyProtocol,
  identity: StudyIdentity,
  _now: Date,
): Promise<void> {
  if (studyCowatchBinding(protocol, identity))
    throw new Error("behavioral_recommendations_retired")
}
