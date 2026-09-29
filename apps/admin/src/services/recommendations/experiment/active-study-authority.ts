import type { Prisma } from "@prisma/client"
import { RecommendationInternalStateError } from "../errors"
import { digestValue } from "../promotion/manifest"
import {
  lockCowatchTrialAuthorityForIssuance,
  type CowatchTrialBinding,
} from "../cowatch/trial-authority.service"
import {
  lockCompositionQualificationForIssuance,
  type CompositionBinding,
} from "../composition/service"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  type ExperimentAssignmentContext,
} from "./assignment"
import {
  calibrationMatchesProtocol,
  readStudyEvaluationAuthority,
} from "./study-authority"
import {
  readStudyDependencies,
  studyManifestPairIsExact,
  studyCowatchBinding,
  type StudyIdentity,
} from "./study-dependencies"
import {
  parseStudyProtocol,
  studyExperimentMatchesProtocol,
  studyProtocolDigest,
  studyChallengerCeilingBps,
  type StudyProtocol,
} from "./study-protocol"

export type ActiveStudyAuthority = Readonly<{
  execution: "semantic" | "legacy_hybrid" | "incumbent" | "cowatch_mmr"
  experimentId: string
  experimentGeneration: number
  protocolDigest: string
  challengerManifestId: string
  validUntil: Date
  cowatch: CowatchTrialBinding | null
  composition: CompositionBinding | null
}>

/** Canonical ISO encoding preserves Date-bearing authority deadlines. */
export const activeStudyAuthorityDigest = (authority: ActiveStudyAuthority) =>
  digestValue(JSON.parse(JSON.stringify(authority)))

/** Bounded indexed reads only: never scans the calibration or serving cohort. */
export async function readActiveStudyAuthority(
  tx: Prisma.TransactionClient,
  input: { assignment: ExperimentAssignmentContext; now: Date },
): Promise<ActiveStudyAuthority | null> {
  const startedAt = Date.now()
  const { assignment: expected, now } = input
  const assignment = await tx.recommendationExperimentAssignment.findUnique({
    where: { id: expected.assignmentId },
    include: {
      profile: true,
      experiment: {
        include: {
          study: true,
          controlManifest: true,
          challengerManifest: true,
        },
      },
    },
  })
  if (!assignment) return null
  const experiment = assignment.experiment,
    study = experiment.study,
    profile = assignment.profile
  if (
    !study ||
    !study.activatedAt ||
    !profile ||
    profile.state !== "ACTIVE" ||
    profile.choice !== "DURABLE_ALLOWED" ||
    profile.expiresAt <= now ||
    assignment.state !== "ACTIVE" ||
    assignment.expiresAt <= now ||
    assignment.privacyGeneration !== profile.privacyGeneration ||
    experiment.assignmentPolicyVersion !==
      PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION ||
    experiment.state !== "ACTIVE" ||
    experiment.expiresAt <= now ||
    experiment.startsAt > now ||
    experiment.endsAt.getTime() + 86_400_000 <= now.getTime() ||
    assignment.assignedAt.getTime() + 86_400_000 <= now.getTime() ||
    assignment.experimentId !== expected.experimentId ||
    experiment.generation !== expected.experimentGeneration ||
    assignment.generation !== expected.experimentGeneration ||
    assignment.configurationDigest !== expected.configurationDigest ||
    experiment.configurationDigest !== expected.configurationDigest ||
    study.protocolDigest !== expected.configurationDigest ||
    assignment.arm.toLowerCase() !== expected.arm ||
    assignment.assignmentProbability !== 0.5 ||
    expected.assignmentProbability !== 0.5 ||
    expected.effectiveManifestId !==
      (expected.arm === "control"
        ? experiment.controlManifestId
        : experiment.challengerManifestId)
  )
    return null
  const protocol = parseStudyProtocol(study.protocol)
  if (
    studyProtocolDigest(protocol) !== study.protocolDigest ||
    !studyExperimentMatchesProtocol(experiment, protocol) ||
    !studyManifestPairIsExact(
      protocol,
      experiment.controlManifest,
      experiment.challengerManifest,
    )
  )
    return null
  const pointer = await tx.recommendationPromotionPointer.findUnique({
    where: { id: "recommendation-promotion-pointer" },
    include: { activeApproval: true },
  })
  if (
    !pointer ||
    pointer.stage !== "BOUNDED" ||
    pointer.killSwitchEnabled ||
    pointer.activeManifestId !== protocol.challengerManifestId ||
    pointer.exposureCeilingBps !== studyChallengerCeilingBps(protocol) ||
    !pointer.activeApproval ||
    pointer.activeApproval.expiresAt <= now ||
    pointer.activeApproval.manifestId !== protocol.challengerManifestId ||
    pointer.activeApproval.manifestDigest !==
      protocol.challengerManifestDigest ||
    pointer.activeApproval.maxExposureBps < pointer.exposureCeilingBps
  )
    return null
  let calibrationValidUntil = Infinity
  if (protocol.mode === "efficacy") {
    const calibration = await readStudyEvaluationAuthority(tx, {
      evaluationId: protocol.calibrationEvaluationId!,
      purpose: "calibration",
      now,
    })
    if (!calibration || !calibrationMatchesProtocol(calibration, protocol))
      return null
    calibrationValidUntil = calibration.expiresAt.getTime()
  }
  const identity = {
    experimentId: experiment.id,
    experimentGeneration: experiment.generation,
    protocolDigest: study.protocolDigest,
  }
  const dependencies = await readStudyDependencies(tx, protocol, identity, now)
  if (!dependencies) return null
  const execution =
    protocol.comparison === "incumbent-aa"
      ? "incumbent"
      : protocol.comparison === "incumbent-cowatch-mmr"
        ? expected.arm === "control"
          ? "incumbent"
          : "cowatch_mmr"
        : protocol.comparison === "semantic-profile" &&
            expected.arm === "challenger"
          ? "legacy_hybrid"
          : "semantic"
  const authority: ActiveStudyAuthority = {
    ...identity,
    execution,
    challengerManifestId: protocol.challengerManifestId,
    validUntil: new Date(
      Math.min(
        dependencies.validUntil.getTime(),
        assignment.expiresAt.getTime(),
        assignment.assignedAt.getTime() + 86_400_000,
        profile.expiresAt.getTime(),
        pointer.activeApproval.expiresAt.getTime(),
        calibrationValidUntil,
      ),
    ),
    cowatch: dependencies.cowatch,
    composition: dependencies.composition,
  }
  return authority.validUntil.getTime() >
    now.getTime() + Math.max(0, Date.now() - startedAt)
    ? authority
    : null
}

/** Same order as privacy writers: profile → graph → composition → study.
 * Must run in the final issuance transaction; locks remain until commit. */
export async function lockActiveStudyAuthorityForIssuance(
  tx: Prisma.TransactionClient,
  input: {
    assignment: ExperimentAssignmentContext
    expected: ActiveStudyAuthority
    now: Date
  },
): Promise<ActiveStudyAuthority> {
  const startedAt = Date.now()
  await tx.$queryRaw`SELECT profile.id FROM recommendation_profile profile
    JOIN recommendation_experiment_assignment assignment ON assignment.profile_id = profile.id
    WHERE assignment.id = ${input.assignment.assignmentId} FOR SHARE OF profile`
  if (input.expected.cowatch)
    await lockCowatchTrialAuthorityForIssuance(
      tx,
      input.expected.cowatch,
      input.now,
    )
  if (input.expected.composition)
    await lockCompositionQualificationForIssuance(
      tx,
      input.expected.composition,
      input.now,
    )
  await tx.$queryRaw`SELECT study.experiment_id FROM recommendation_study study
    WHERE study.experiment_id = ${input.assignment.experimentId}
      OR study.experiment_id IN (SELECT authority.study_id FROM recommendation_study_evaluation authority
        JOIN recommendation_study active ON active.protocol->>'calibrationEvaluationId' = authority.evaluation_id
        WHERE active.experiment_id = ${input.assignment.experimentId})
    ORDER BY study.experiment_id FOR SHARE`
  await tx.$queryRaw`SELECT assignment.id FROM recommendation_experiment_assignment assignment
    JOIN recommendation_experiment experiment ON experiment.id = assignment.experiment_id
    JOIN recommendation_promotion_pointer pointer ON pointer.id = 'recommendation-promotion-pointer'
    JOIN recommendation_promotion_approval approval ON approval.id = pointer.active_approval_id
    WHERE assignment.id = ${input.assignment.assignmentId} FOR SHARE OF assignment, experiment, pointer, approval`
  const authority = await readActiveStudyAuthority(tx, {
    ...input,
    now: new Date(input.now.getTime() + Math.max(0, Date.now() - startedAt)),
  })
  if (
    !authority ||
    activeStudyAuthorityDigest(authority) !==
      activeStudyAuthorityDigest(input.expected)
  )
    throw new RecommendationInternalStateError("active_study_authority_fenced")
  return authority
}

/** The caller already holds the enrolling profile lock. Acquire dependencies
 * before INSERT accounting updates the study row, preserving privacy lock order. */
export async function lockStudyAdmissionAuthority(
  tx: Prisma.TransactionClient,
  input: { protocol: StudyProtocol; identity: StudyIdentity; now: Date },
) {
  const { protocol, identity, now } = input
  const graph = studyCowatchBinding(protocol, identity)
  if (graph) await lockCowatchTrialAuthorityForIssuance(tx, graph, now)
  if (protocol.composition)
    await lockCompositionQualificationForIssuance(tx, protocol.composition, now)
  if (protocol.mode === "efficacy") {
    await tx.$queryRaw`SELECT study.experiment_id FROM recommendation_study study
      JOIN recommendation_study_evaluation authority ON authority.study_id = study.experiment_id
      WHERE authority.evaluation_id = ${protocol.calibrationEvaluationId} FOR SHARE OF study`
    const calibration = await readStudyEvaluationAuthority(tx, {
      evaluationId: protocol.calibrationEvaluationId!,
      purpose: "calibration",
      now,
    })
    if (!calibration || !calibrationMatchesProtocol(calibration, protocol))
      throw new RecommendationInternalStateError(
        "study_calibration_authority_fenced",
      )
  }
  const dependencies = await readStudyDependencies(tx, protocol, identity, now)
  if (!dependencies)
    throw new RecommendationInternalStateError("study_source_authority_fenced")
  await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = 'recommendation-promotion-pointer' FOR SHARE`
}
