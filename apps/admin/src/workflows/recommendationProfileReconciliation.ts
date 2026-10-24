import { getWorkflowMetadata, sleep } from "workflow"

export async function runRecommendationProfileReconciliationScheduler(
  input: { ledgerRunId?: string } = {},
): Promise<never> {
  "use workflow"
  await stepMarkRecommendationProfileReconciliationStarted(input)
  while (true) {
    let result: Awaited<
      ReturnType<typeof stepRunRecommendationProfileReconciliation>
    > | null = null
    try {
      result = await stepRunRecommendationProfileReconciliation()
    } catch {
      // Keep the durable scheduler alive after a temporary database or batch
      // failure. The null heartbeat makes unavailable evidence explicit.
    }
    const next = await stepRecordRecommendationProfileReconciliationHeartbeat(
      input,
      result,
    )
    await sleep(next)
  }
}

async function stepMarkRecommendationProfileReconciliationStarted(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  const { markRecommendationProfileReconciliationSchedulerStarted } =
    await import("@/services/recommendations/profiles/reconciliation.job")
  await markRecommendationProfileReconciliationSchedulerStarted(
    input.ledgerRunId,
    getWorkflowMetadata().workflowRunId,
  )
}

async function stepRunRecommendationProfileReconciliation() {
  "use step"
  const { runRecommendationProfileReconciliationFromScheduler } =
    await import("@/services/recommendations/profiles/reconciliation.job")
  return runRecommendationProfileReconciliationFromScheduler()
}

async function stepRecordRecommendationProfileReconciliationHeartbeat(
  input: { ledgerRunId?: string },
  result: Awaited<
    ReturnType<typeof stepRunRecommendationProfileReconciliation>
  > | null,
) {
  "use step"
  const {
    nextRecommendationProfileReconciliationRunAt,
    recordRecommendationProfileReconciliationHeartbeat,
  } = await import("@/services/recommendations/profiles/reconciliation.job")
  const nextRunAt = nextRecommendationProfileReconciliationRunAt()
  await recordRecommendationProfileReconciliationHeartbeat(input.ledgerRunId, {
    nextRunAt,
    result,
  })
  return nextRunAt
}
