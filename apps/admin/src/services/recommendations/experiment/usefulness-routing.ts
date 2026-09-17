import type { Prisma, PrismaClient } from "@prisma/client"
import { RECOMMENDATION_CONTRACTS } from "../contracts"
import { runRecommendationDeliveryTransaction } from "../delivery-runtime"
import { RecommendationInternalStateError } from "../errors"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  resolveExperimentAssignment,
  type ExperimentAssignmentContext,
  type ExperimentAssignmentResolution,
} from "./assignment"

export function assignProfileUsefulnessExperiment(
  prisma: PrismaClient,
  input: {
    sessionDigest: string
    profileTokenDigest: string
    eligibleForEnrollment: boolean
    now: Date
    deadlineAt: number
  },
): Promise<ExperimentAssignmentResolution> {
  return runRecommendationDeliveryTransaction(
    prisma,
    input.deadlineAt,
    async (tx) => {
      const active = await tx.recommendationExperiment.findMany({
        where: {
          state: "ACTIVE",
          surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
          assignmentPolicyVersion: PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
          startsAt: { lte: input.now },
          endsAt: { gt: new Date(input.now.getTime() - 86_400_000) },
          expiresAt: { gt: input.now },
        },
        select: { id: true },
        take: 2,
      })
      // Do not replace a still-followed cohort with a newer overlapping study.
      // With no configured study this avoids locking ordinary viewer profiles.
      if (active.length !== 1)
        return { assignment: null, bypassReason: "no_active_experiment" }
      // Reset/delete must order before or after enrollment, never between the
      // generation check and insertion of a newly active assignment.
      const profiles = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM recommendation_profile
      WHERE token_digest = ${input.profileTokenDigest}
        AND state = 'active' AND expires_at > ${input.now}
      FOR UPDATE
    `
      if (!profiles.length)
        return { assignment: null, bypassReason: "assignment_fenced" }
      return resolveExperimentAssignment(tx as unknown as PrismaClient, {
        surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
        sessionDigest: input.sessionDigest,
        profileTokenDigest: input.profileTokenDigest,
        eligibleHuman: true,
        profileUsefulness: {
          eligibleForEnrollment: input.eligibleForEnrollment,
        },
        now: input.now,
      })
    },
    Date.now,
  )
}

export async function lockProfileUsefulnessAssignment(
  tx: Prisma.TransactionClient,
  input: {
    assignment: ExperimentAssignmentContext
    profileTokenDigest: string
    now: Date
  },
): Promise<void> {
  const { assignment, now } = input
  await tx.$queryRaw`
    SELECT id FROM recommendation_profile WHERE token_digest = ${input.profileTokenDigest} FOR SHARE
  `
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT assignment.id
    FROM recommendation_experiment_assignment assignment
    JOIN recommendation_profile profile ON profile.id = assignment.profile_id
    JOIN recommendation_experiment experiment ON experiment.id = assignment.experiment_id
    JOIN recommendation_promotion_pointer pointer
      ON pointer.id = 'recommendation-promotion-pointer'
    JOIN recommendation_promotion_approval approval ON approval.id = pointer.active_approval_id
    WHERE assignment.id = ${assignment.assignmentId}
      AND assignment.state = 'active' AND assignment.expires_at > ${now}
      AND assignment.configuration_digest = ${assignment.configurationDigest}
      AND assignment.generation = ${assignment.experimentGeneration}
      AND assignment.privacy_generation = profile.privacy_generation
      AND profile.token_digest = ${input.profileTokenDigest}
      AND profile.state = 'active' AND profile.expires_at > ${now}
      AND experiment.state = 'active' AND experiment.expires_at > ${now}
      AND experiment.starts_at <= ${now} AND experiment.ends_at + interval '24 hours' > ${now}
      AND assignment.assigned_at + interval '24 hours' > ${now}
      AND experiment.generation = assignment.generation
      AND experiment.configuration_digest = assignment.configuration_digest
      AND experiment.assignment_policy_version = ${PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION}
      AND experiment.challenger_probability = 0.5
      AND pointer.stage = 'bounded' AND NOT pointer.kill_switch_enabled
      AND pointer.exposure_ceiling_bps = 5000
      AND pointer.active_manifest_id = experiment.challenger_manifest_id
      AND approval.manifest_id = pointer.active_manifest_id
      AND approval.expires_at > ${now} AND approval.max_exposure_bps >= 5000
    FOR SHARE OF assignment, profile, experiment, pointer, approval
  `
  if (!rows.length)
    throw new RecommendationInternalStateError("experiment_assignment_fenced")
}
