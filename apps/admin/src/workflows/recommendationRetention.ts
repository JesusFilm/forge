import { getWorkflowMetadata, RetryableError, sleep } from "workflow"
import type { RecommendationPurgeResult } from "@/services/recommendations/retention.service"

export const RECOMMENDATION_RETENTION_CATCH_UP_BATCH_LIMIT = 8
export const RECOMMENDATION_RETENTION_CATCH_UP_WINDOW_MS = 30_000

type RecommendationRetentionCatchUpResult = Readonly<{
  batchesProcessed: number
  overdueAfterRun: boolean
}>

export async function runRecommendationRetention(
  input: {
    ledgerRunId?: string
  } = {},
): Promise<RecommendationPurgeResult> {
  "use workflow"
  return stepRunRecommendationRetention(input)
}

async function stepRunRecommendationRetention(input: {
  ledgerRunId?: string
}): Promise<RecommendationPurgeResult> {
  "use step"
  const { runRecommendationRetentionJob } =
    await import("@/services/recommendations/retention/job")
  return runRecommendationRetentionJob(input)
}

export async function runRecommendationRetentionScheduler(
  input: {
    ledgerRunId?: string
  } = {},
): Promise<never> {
  "use workflow"
  await stepMarkRecommendationRetentionSchedulerStarted(input)
  while (true) {
    let catchUp: RecommendationRetentionCatchUpResult | undefined
    try {
      catchUp = await stepRunScheduledRecommendationRetention()
    } catch {
      // The bounded retry policy has been exhausted and every failed attempt
      // has its own purge ledger. Keep the durable daily scheduler alive so a
      // transient outage does not permanently stop privacy retention.
    }
    if (catchUp?.overdueAfterRun) {
      const next = await stepNextRecommendationRetentionCatchUpRun(input)
      await sleep(next)
      continue
    }
    const next = await stepNextRecommendationRetentionRun(input)
    await sleep(next)
  }
}

export async function stepMarkRecommendationRetentionSchedulerStarted(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  const { markRecommendationRetentionSchedulerRuntimeStarted } =
    await import("@/services/recommendations/retention/job")
  await markRecommendationRetentionSchedulerRuntimeStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

export async function stepRunScheduledRecommendationRetention(): Promise<RecommendationRetentionCatchUpResult> {
  "use step"
  const { runRecommendationRetentionFromScheduler } =
    await import("@/services/recommendations/retention/job")
  const startedAt = Date.now()
  let batchesProcessed = 0
  let overdueAfterRun = false
  do {
    const attempt = await runRecommendationRetentionFromScheduler()
    if (!attempt.ok || !attempt.result) {
      throw new RetryableError("Recommendation retention purge failed", {
        retryAfter: "5m",
      })
    }
    batchesProcessed += 1
    overdueAfterRun = attempt.result.overdueAfterRun
  } while (
    overdueAfterRun &&
    batchesProcessed < RECOMMENDATION_RETENTION_CATCH_UP_BATCH_LIMIT &&
    Date.now() - startedAt < RECOMMENDATION_RETENTION_CATCH_UP_WINDOW_MS
  )
  return { batchesProcessed, overdueAfterRun }
}

stepRunScheduledRecommendationRetention.maxRetries = 5

async function stepNextRecommendationRetentionCatchUpRun(input: {
  ledgerRunId?: string
}): Promise<Date> {
  "use step"
  const {
    nextRecommendationRetentionCatchUpRunAt,
    recordRecommendationRetentionSchedulerCatchUpHeartbeat,
  } = await import("@/services/recommendations/retention/job")
  const next = nextRecommendationRetentionCatchUpRunAt()
  await recordRecommendationRetentionSchedulerCatchUpHeartbeat(
    input.ledgerRunId,
    next,
  )
  return next
}

async function stepNextRecommendationRetentionRun(input: {
  ledgerRunId?: string
}): Promise<Date> {
  "use step"
  const {
    nextRecommendationRetentionRunAt,
    recordRecommendationRetentionSchedulerHeartbeat,
  } = await import("@/services/recommendations/retention/job")
  const next = nextRecommendationRetentionRunAt()
  await recordRecommendationRetentionSchedulerHeartbeat(input.ledgerRunId, next)
  return next
}
