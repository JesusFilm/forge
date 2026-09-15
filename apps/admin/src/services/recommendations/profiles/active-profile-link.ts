import { RecommendationProfileState, type PrismaClient } from "@prisma/client"

export type ActiveRecommendationProfileLink = Readonly<{
  profileId: string
  privacyGeneration: number
}>

/**
 * Resolves the current consented profile directly from the short-lived session
 * bridge. Experiment assignment is not profile or consent authority.
 */
export async function resolveActiveRecommendationProfileLink(
  prisma: Pick<PrismaClient, "recommendationProfileSessionLink">,
  input: { sessionDigest: string; now: Date },
): Promise<ActiveRecommendationProfileLink | null> {
  const link = await prisma.recommendationProfileSessionLink.findFirst({
    where: {
      sessionDigest: input.sessionDigest,
      expiresAt: { gt: input.now },
      profile: {
        is: {
          state: RecommendationProfileState.ACTIVE,
          tokenDigest: { not: null },
          expiresAt: { gt: input.now },
        },
      },
    },
    orderBy: [{ linkedAt: "desc" }, { id: "desc" }],
    select: {
      profileId: true,
      privacyGeneration: true,
      profile: {
        select: {
          privacyGeneration: true,
        },
      },
    },
  })
  if (!link || link.privacyGeneration !== link.profile.privacyGeneration) {
    return null
  }
  return {
    profileId: link.profileId,
    privacyGeneration: link.privacyGeneration,
  }
}
