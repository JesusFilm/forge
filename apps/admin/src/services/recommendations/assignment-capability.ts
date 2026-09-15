import {
  Prisma,
  RecommendationExperimentAssignmentState,
  RecommendationProfileState,
} from "@prisma/client"

type PersonalizedAssignmentCapability = {
  profileId?: string | null
  privacyGeneration?: number | null
  state?: RecommendationExperimentAssignmentState | null
  expiresAt?: Date | null
  profile?: {
    state: RecommendationProfileState
    tokenDigest: string | null
    privacyGeneration: number
    expiresAt: Date
  } | null
}

/**
 * A profile-linked capability stops authorizing new evidence as soon as its
 * assignment or profile privacy generation is fenced. Session/control
 * assignments have no durable profile link and retain their normal lifetime.
 */
export function isRecommendationAssignmentCapabilityCurrent(
  assignment: PersonalizedAssignmentCapability | null | undefined,
  now: Date,
): boolean {
  if (!assignment?.profileId) return true
  return (
    assignment.state === RecommendationExperimentAssignmentState.ACTIVE &&
    assignment.expiresAt != null &&
    assignment.expiresAt > now &&
    assignment.privacyGeneration != null &&
    assignment.profile != null &&
    assignment.profile.state === RecommendationProfileState.ACTIVE &&
    assignment.profile.tokenDigest != null &&
    assignment.profile.privacyGeneration === assignment.privacyGeneration &&
    assignment.profile.expiresAt > now
  )
}

/**
 * Serializes personalized evidence commits with profile withdrawal. Holding a
 * share lock means either the evidence commits before withdrawal, or it waits
 * for withdrawal and observes the fenced generation before writing.
 */
export async function lockRecommendationAssignmentCapabilityFence(
  tx: Prisma.TransactionClient,
  assignment:
    | (PersonalizedAssignmentCapability & { id: string })
    | null
    | undefined,
  now: Date,
): Promise<boolean> {
  if (!assignment?.profileId) return true
  // Match withdrawal's profile -> assignment update order to avoid a lock
  // inversion while still linearizing every personalized evidence write.
  const profile = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM recommendation_profile
    WHERE id = ${assignment.profileId}
      AND state = 'active'
      AND token_digest IS NOT NULL
      AND privacy_generation = ${assignment.privacyGeneration}
      AND expires_at > ${now}
    FOR SHARE
  `)
  if (profile.length !== 1) return false
  const currentAssignment = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM recommendation_experiment_assignment
      WHERE id = ${assignment.id}
        AND profile_id = ${assignment.profileId}
        AND state = 'active'
        AND privacy_generation = ${assignment.privacyGeneration}
        AND expires_at > ${now}
      FOR SHARE
    `,
  )
  return currentAssignment.length === 1
}
