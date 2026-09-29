import type { Prisma } from "@prisma/client"
import { RecommendationInputError } from "../errors"
import { recommendationManifestDigest } from "../promotion/manifest"
import {
  parseStudyProtocol,
  studyProtocolDigest,
  STUDY_POLICY_VERSION,
} from "./study-protocol"

export async function assertStudyAuthority(
  tx: Prisma.TransactionClient,
  input: {
    evaluationId: string
    purpose: "calibration" | "advancement"
    now: Date
  },
) {
  await tx.$queryRaw`SELECT study.experiment_id
    FROM recommendation_study_evaluation authority
    JOIN recommendation_study study ON study.experiment_id = authority.study_id
    JOIN recommendation_experiment experiment ON experiment.id = study.experiment_id
    WHERE authority.evaluation_id = ${input.evaluationId}
    FOR SHARE OF study, experiment`
  const authority = await tx.recommendationStudyEvaluation.findUnique({
    where: { evaluationId: input.evaluationId },
    include: {
      study: {
        include: {
          experiment: {
            include: { controlManifest: true, challengerManifest: true },
          },
        },
      },
      evaluation: { include: { supersededBy: true } },
    },
  })
  if (!authority)
    throw new RecommendationInputError(
      "Version-bound study authority is required",
    )
  const { study, evaluation } = authority
  const experiment = study.experiment
  const protocol = parseStudyProtocol(study.protocol)
  const latest = await tx.recommendationStudyEvaluation.findFirst({
    where: { studyId: study.experimentId },
    orderBy: { evaluation: { revision: "desc" } },
    select: { evaluationId: true },
  })
  const result = authority.result as Record<string, unknown>
  const expected =
    input.purpose === "calibration" ? "calibration_pass" : "improve"
  if (
    latest?.evaluationId !== evaluation.id ||
    evaluation.supersededBy ||
    evaluation.state !== "PASS" ||
    authority.expiresAt <= input.now ||
    evaluation.expiresAt <= input.now ||
    authority.protocolDigest !== study.protocolDigest ||
    experiment.configurationDigest !== study.protocolDigest ||
    authority.experimentGeneration !== experiment.generation ||
    authority.privacyRevision !== study.privacyRevision ||
    evaluation.evaluationPolicyVersion !== STUDY_POLICY_VERSION ||
    result.schemaVersion !== "recommendation-usefulness-offline-v2" ||
    studyProtocolDigest(protocol) !== study.protocolDigest ||
    evaluation.experimentId !== study.experimentId ||
    result.decision !== expected ||
    authority.mode !==
      (input.purpose === "calibration" ? "calibration" : "efficacy") ||
    protocol.controlManifestDigest !==
      recommendationManifestDigest(experiment.controlManifest) ||
    protocol.challengerManifestDigest !==
      recommendationManifestDigest(experiment.challengerManifest)
  )
    throw new RecommendationInputError(
      "Study authority is stale, superseded or invalid",
    )
  const [health] = await tx.$queryRaw<
    Array<{ invalid: boolean }>
  >`SELECT EXISTS (
    SELECT 1 FROM recommendation_experiment_assignment assignment
    LEFT JOIN recommendation_profile profile ON profile.id = assignment.profile_id
    WHERE assignment.experiment_id = ${study.experimentId}
      AND (assignment.state <> 'active' OR assignment.expires_at <= ${input.now}
        OR profile.state IS DISTINCT FROM 'active' OR profile.expires_at <= ${input.now}
        OR profile.privacy_generation IS DISTINCT FROM assignment.privacy_generation)
  ) AS invalid`
  if (health?.invalid !== false)
    throw new RecommendationInputError(
      "Study cohort authority expired or was fenced",
    )
  // A later revision of an outcome may reverse the evaluated result without
  // changing assignment or manifest identity. Require a new mature publication.
  const changed = await tx.recommendationOutcomeRevision.findFirst({
    where: {
      request: { experimentAssignment: { experimentId: study.experimentId } },
      createdAt: { gt: evaluation.inputCapturedAt },
    },
    select: { id: true },
  })
  const lateFacts = await tx.recommendationPlaybackFact.findFirst({
    where: {
      request: { experimentAssignment: { experimentId: study.experimentId } },
      receivedAt: { gt: evaluation.inputCapturedAt },
    },
    select: { id: true },
  })
  const changedEligibility =
    await tx.recommendationEligibilityDecision.findFirst({
      where: {
        outcome: {
          request: {
            experimentAssignment: { experimentId: study.experimentId },
          },
        },
        decidedAt: { gt: evaluation.inputCapturedAt },
      },
      select: { id: true },
    })
  const changedMode = await tx.recommendationViewingModeEvidence.findFirst({
    where: {
      episode: {
        request: { experimentAssignment: { experimentId: study.experimentId } },
      },
      observedAt: { gt: evaluation.inputCapturedAt },
    },
    select: { episodeId: true },
  })
  if (changed || lateFacts || changedEligibility || changedMode)
    throw new RecommendationInputError(
      "Study outcomes changed after evaluation",
    )
  if (
    input.purpose === "advancement" &&
    protocol.controlExecution !== String(protocol.incumbentExecution)
  )
    throw new RecommendationInputError(
      "Study comparator does not match the live incumbent",
    )
  return authority
}
