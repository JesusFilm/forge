import { Prisma, type PrismaClient } from "@prisma/client"
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
  const consumed = await consumeBudget(
    prisma,
    "delivery",
    Prisma.sql`
    consume_recommendation_capability_submissions(
      ${input.requestId}, ${input.capabilityJti},
      ${input.attempts}::integer,
      ${MAX_DELIVERY_CAPABILITY_SUBMISSIONS}::integer, ${input.expiresAt}
    )
  `,
  )
  if (consumed) return

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
  const consumed = await consumeBudget(
    prisma,
    "episode",
    Prisma.sql`
    consume_recommendation_episode_capability_submissions(
      ${input.requestId}, ${input.episodeId}, ${input.capabilityJti},
      ${input.attempts}::integer,
      ${MAX_EPISODE_CAPABILITY_SUBMISSIONS}::integer,
      ${input.expiresAt}
    )
  `,
  )
  if (consumed) return

  throw new RecommendationBindingError(
    "Recommendation playback submission budget is exhausted",
  )
}

async function consumeBudget(
  prisma: SubmissionBudgetClient,
  kind: "delivery" | "episode",
  consumption: Prisma.Sql,
): Promise<boolean> {
  const started = performance.now()
  // Materialization brackets one invocation without moving its commit boundary.
  // Server time excludes the implicit commit and client/pool/transport work.
  const rows = await prisma.$queryRaw<
    Array<{ attempts: number | null; serverElapsedMs: number }>
  >(Prisma.sql`
    WITH budget_clock AS MATERIALIZED (
      SELECT clock_timestamp() AS started_at
    ), budget_result AS MATERIALIZED (
      SELECT ${consumption} AS attempts, budget_clock.started_at
      FROM budget_clock
    )
    SELECT attempts,
      (EXTRACT(EPOCH FROM (clock_timestamp() - started_at)) * 1000)::double precision
        AS "serverElapsedMs"
    FROM budget_result
  `)
  const elapsed = performance.now() - started
  const serverElapsed = rows[0]?.serverElapsedMs
  if (
    Number.isFinite(elapsed) &&
    elapsed >= 200 &&
    elapsed <= 300_000 &&
    typeof serverElapsed === "number" &&
    Number.isFinite(serverElapsed) &&
    serverElapsed >= 0 &&
    serverElapsed <= elapsed
  ) {
    try {
      const elapsedMs = Math.round(elapsed)
      const serverElapsedMs = Math.round(serverElapsed)
      console.info(
        `event=recommendation.submission_budget kind=${kind} elapsedMs=${elapsedMs} serverElapsedMs=${serverElapsedMs} outsideServerMs=${elapsedMs - serverElapsedMs}`,
      )
    } catch {
      // Diagnostics cannot change a committed budget result.
    }
  }
  return rows[0]?.attempts != null
}
