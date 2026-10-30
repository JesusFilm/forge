import type { Prisma } from "@prisma/client"

type PersonalizedAssignmentCapability = {
  profileId?: string | null
  privacyGeneration?: number | null
  state?: string | null
  expiresAt?: Date | null
}

/**
 * Historical profile-linked assignments are no longer valid capabilities.
 * Session/control assignments retain their normal lifetime.
 */
export function isRecommendationAssignmentCapabilityCurrent(
  assignment: PersonalizedAssignmentCapability | null | undefined,
  now: Date,
): boolean {
  void now
  return !assignment?.profileId
}

/**
 * Retired profile-linked evidence cannot be admitted. No profile table access
 * is needed for retained session and control evidence.
 */
export async function lockRecommendationAssignmentCapabilityFence(
  _tx: Prisma.TransactionClient,
  assignment:
    | (PersonalizedAssignmentCapability & { id: string })
    | null
    | undefined,
  _now: Date,
): Promise<boolean> {
  return !assignment?.profileId
}
