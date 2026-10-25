import { getWorkflowMetadata, sleep } from "workflow"

export async function runRecommendationCowatchRefreshScheduler(
  input: { ledgerRunId?: string } = {},
): Promise<never> {
  "use workflow"
  await stepMarkRecommendationCowatchRefreshStarted(input)
  while (true) {
    let result: Awaited<
      ReturnType<typeof stepRunRecommendationCowatchRefresh>
    > | null = null
    try {
      result = await stepRunRecommendationCowatchRefresh()
    } catch {
      // Keep the durable scheduler alive after a temporary database or batch
      // failure. The null heartbeat makes unavailable evidence explicit.
    }
    const next = await stepRecordRecommendationCowatchRefreshHeartbeat(
      input,
      result,
    )
    await sleep(next)
  }
}

async function stepMarkRecommendationCowatchRefreshStarted(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  const { markRecommendationCowatchRefreshSchedulerStarted } =
    await import("@/services/recommendations/cowatch/refresh.job")
  await markRecommendationCowatchRefreshSchedulerStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationCowatchRefresh() {
  "use step"
  const { runRecommendationCowatchRefreshFromScheduler } =
    await import("@/services/recommendations/cowatch/refresh.job")
  return runRecommendationCowatchRefreshFromScheduler()
}

async function stepRecordRecommendationCowatchRefreshHeartbeat(
  input: { ledgerRunId?: string },
  result: Awaited<
    ReturnType<typeof stepRunRecommendationCowatchRefresh>
  > | null,
) {
  "use step"
  const {
    nextRecommendationCowatchRefreshRunAt,
    recordRecommendationCowatchRefreshHeartbeat,
  } = await import("@/services/recommendations/cowatch/refresh.job")
  const nextRunAt = nextRecommendationCowatchRefreshRunAt()
  await recordRecommendationCowatchRefreshHeartbeat(input.ledgerRunId, {
    nextRunAt,
    result,
  })
  return nextRunAt
}
