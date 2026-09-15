import type { Prisma } from "@prisma/client"
import { RecommendationInternalStateError } from "./errors"
import { observeRecommendationEvidence } from "./evidence-observability"

const MAX_SERIALIZABLE_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 5
const MAX_EPISODE_LOCK_ATTEMPTS = 64
const EPISODE_LOCK_BUDGET_MS = 1_500

class RecommendationEpisodeLockBusyError extends Error {}

/** Do not wait inside Serializable: even the lock query establishes a snapshot. */
export async function lockRecommendationEpisode(
  tx: Prisma.TransactionClient,
  episodeId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${episodeId}, 368)) AS locked
  `
  if (rows[0]?.locked !== true) throw new RecommendationEpisodeLockBusyError()
}

function prismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const code = "code" in error ? String(error.code) : null
  if (code) return code
  return "cause" in error ? prismaErrorCode(error.cause) : null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Retry only Serializable conflicts and our nonblocking episode lock contention.
 * Busy locks consume their own budget so they cannot exhaust P2034 recovery.
 */
export async function withRecommendationSerializableRetry<T>(
  operation: () => Promise<T>,
  action?: "facts" | "finalize",
): Promise<T> {
  const startedAt = performance.now()
  let serializationAttempt = 1
  let lockAttempt = 0
  for (;;) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof RecommendationEpisodeLockBusyError) {
        lockAttempt += 1
        const remaining =
          EPISODE_LOCK_BUDGET_MS - (performance.now() - startedAt)
        if (lockAttempt >= MAX_EPISODE_LOCK_ATTEMPTS || remaining <= 0) {
          if (action)
            observeRecommendationEvidence({
              action,
              outcome: "failed",
              reason: "transaction_exhausted",
              timeoutStage: "transaction",
              retryDisposition: "exhausted",
              retryAttempt: lockAttempt,
            })
          throw new RecommendationInternalStateError(
            "recommendation_episode_lock_exhausted",
          )
        }
        if (action)
          observeRecommendationEvidence({
            action,
            outcome: "failed",
            reason: "transaction_busy",
            retryDisposition: "retryable",
            retryAttempt: lockAttempt,
          })
        // The rejected transaction has released its connection and snapshot.
        await sleep(Math.min(remaining, 15 + Math.floor(Math.random() * 26)))
        continue
      }
      if (action && prismaErrorCode(error) === "P2034") {
        const exhausted = serializationAttempt === MAX_SERIALIZABLE_ATTEMPTS
        observeRecommendationEvidence({
          action,
          outcome: "failed",
          reason: exhausted ? "transaction_exhausted" : "transaction_busy",
          retryDisposition: exhausted ? "exhausted" : "retryable",
          retryAttempt: serializationAttempt,
        })
      }
      if (
        prismaErrorCode(error) !== "P2034" ||
        serializationAttempt === MAX_SERIALIZABLE_ATTEMPTS
      ) {
        throw error
      }
      await sleep(BASE_RETRY_DELAY_MS * 2 ** (serializationAttempt - 1))
      serializationAttempt += 1
    }
  }
}
