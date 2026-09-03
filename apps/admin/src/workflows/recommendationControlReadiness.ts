import { getWorkflowMetadata, RetryableError, sleep } from "workflow"

export async function runRecommendationControlReadinessScheduler(
  input: { ledgerRunId?: string } = {},
): Promise<never> {
  "use workflow"
  await stepMarkRecommendationControlReadinessSchedulerStarted(input)
  while (true) {
    try {
      await stepRunRecommendationControlReadiness()
    } catch {
      // Each failed evaluation has its own ledger. Keep the durable daily
      // scheduler alive after bounded retries are exhausted.
    }
    try {
      await stepRunPlaybackProxyReadiness()
    } catch {
      // Proxy readiness is offline evidence only. Keep the shared daily
      // scheduler alive after its independently logged evaluation fails.
    }
    const next = await stepNextRecommendationControlReadinessRun(input)
    await sleep(next)
  }
}

export async function stepMarkRecommendationControlReadinessSchedulerStarted(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  const { markRecommendationControlReadinessSchedulerRuntimeStarted } =
    await import("@/services/recommendations/control-readiness/job")
  await markRecommendationControlReadinessSchedulerRuntimeStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationControlReadiness(): Promise<void> {
  "use step"
  const { runRecommendationControlReadinessFromScheduler } =
    await import("@/services/recommendations/control-readiness/job")
  const result = await runRecommendationControlReadinessFromScheduler()
  if (!result.ok) {
    throw new RetryableError("Recommendation control readiness failed", {
      retryAfter: "5m",
    })
  }
}

stepRunRecommendationControlReadiness.maxRetries = 5

async function stepRunPlaybackProxyReadiness(): Promise<void> {
  "use step"
  const { runPlaybackProxyReadinessFromScheduler } =
    await import("@/services/recommendations/proxy-readiness.job")
  const result = await runPlaybackProxyReadinessFromScheduler()
  if (!result.ok) {
    throw new RetryableError("Playback proxy readiness failed", {
      retryAfter: "5m",
    })
  }
}

stepRunPlaybackProxyReadiness.maxRetries = 5

async function stepNextRecommendationControlReadinessRun(input: {
  ledgerRunId?: string
}): Promise<Date> {
  "use step"
  const {
    nextRecommendationControlReadinessRunAt,
    recordRecommendationControlReadinessSchedulerHeartbeat,
  } = await import("@/services/recommendations/control-readiness/job")
  const next = nextRecommendationControlReadinessRunAt()
  await recordRecommendationControlReadinessSchedulerHeartbeat(
    input.ledgerRunId,
    next,
  )
  return next
}
