import { getWorkflowMetadata, sleep } from "workflow"

export async function runRecommendationProfileReconciliationScheduler(
  input: { ledgerRunId?: string } = {},
): Promise<void> {
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
    if (result?.retired === true) {
      await stepCompleteBehavioralRetirement(input)
      return
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

async function stepCompleteBehavioralRetirement(input: {
  ledgerRunId?: string
}): Promise<void> {
  "use step"
  if (!input.ledgerRunId) return
  const { prisma } = await import("@/db/client")
  await prisma.workflowRun.updateMany({
    where: { id: input.ledgerRunId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      summary: "Behavioral recommendations retired.",
    },
  })
}
