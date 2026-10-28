import { prisma } from "@/db/client"
import { markWorkflowRunRuntimeStarted } from "@/services/workflow-run-log.service"

import { RecommendationCowatchRefreshService } from "./refresh.service"

export const RECOMMENDATION_COWATCH_REFRESH_SCHEDULER_WORKFLOW_KEY =
  "recommendation-cowatch-refresh-scheduler"

const REFRESH_CHECK_INTERVAL_MS = 5 * 60_000

export function nextRecommendationCowatchRefreshRunAt(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + REFRESH_CHECK_INTERVAL_MS)
}

export async function runRecommendationCowatchRefreshFromScheduler() {
  return new RecommendationCowatchRefreshService({ prisma }).run()
}

export async function recordRecommendationCowatchRefreshHeartbeat(
  ledgerRunId: string | undefined,
  input: {
    nextRunAt: Date
    result: Awaited<
      ReturnType<RecommendationCowatchRefreshService["run"]>
    > | null
  },
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      summary: `Co-watch refresh sleeping until ${input.nextRunAt.toISOString()}.`,
      details: {
        schedule: "every 5 minutes",
        nextRunAt: input.nextRunAt.toISOString(),
        lastBatchStatus: input.result ? "completed" : "unavailable",
        lastBatch: input.result,
      },
    },
  })
  // Emitted only after the durable heartbeat commits. Do not include ledger
  // identity or batch contents in operational telemetry.
  try {
    console.info(
      "event=recommendation.cowatch_refresh.heartbeat outcome=" +
        (input.result ? "completed" : "unavailable"),
    )
  } catch {
    // Observability cannot interrupt the five-minute scheduler.
  }
}

export async function ensureRecommendationCowatchRefreshSchedulerStarted(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  return { started: false }
}

export async function markRecommendationCowatchRefreshSchedulerStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}
