import type { Prisma, PrismaClient } from "@prisma/client"
import { RecommendationBindingError } from "./errors"

/**
 * One delivery capability normally submits render, impression, and selection.
 * Thirty-two event attempts leave ample retry room while placing a fixed upper
 * bound on anonymous replay/conflict amplification independent of event ids.
 */
export const MAX_DELIVERY_CAPABILITY_SUBMISSIONS = 32
export const MAX_EPISODE_CAPABILITY_SUBMISSIONS = 256

type SubmissionBudgetClient = Pick<PrismaClient, "$queryRaw">

export async function consumeDeliveryCapabilitySubmissions(
  prisma: SubmissionBudgetClient | Prisma.TransactionClient,
  input: {
    requestId: string
    capabilityJti: string
    attempts: number
    expiresAt: Date
  },
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ attempts: number | null }>>`
    SELECT consume_recommendation_capability_submissions(
      ${input.requestId}, ${input.capabilityJti},
      ${input.attempts}::integer,
      ${MAX_DELIVERY_CAPABILITY_SUBMISSIONS}::integer, ${input.expiresAt}
    ) AS attempts
  `
  if (rows[0]?.attempts != null) return

  throw new RecommendationBindingError(
    "Recommendation evidence submission budget is exhausted",
  )
}

export async function consumeEpisodeCapabilitySubmissions(
  prisma: SubmissionBudgetClient | Prisma.TransactionClient,
  input: {
    requestId: string | null
    episodeId: string
    capabilityJti: string
    attempts: number
    expiresAt: Date
  },
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ attempts: number | null }>>`
    SELECT consume_recommendation_episode_capability_submissions(
      ${input.requestId}, ${input.episodeId}, ${input.capabilityJti},
      ${input.attempts}::integer,
      ${MAX_EPISODE_CAPABILITY_SUBMISSIONS}::integer,
      ${input.expiresAt}
    ) AS attempts
  `
  if (rows[0]?.attempts != null) return

  throw new RecommendationBindingError(
    "Recommendation playback submission budget is exhausted",
  )
}
