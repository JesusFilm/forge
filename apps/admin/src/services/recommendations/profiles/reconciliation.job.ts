import { prisma } from "@/db/client"
import { markWorkflowRunRuntimeStarted } from "@/services/workflow-run-log.service"

import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"

export const RECOMMENDATION_PROFILE_RECONCILIATION_SCHEDULER_WORKFLOW_KEY =
  "recommendation-profile-reconciliation-scheduler"

const RECONCILIATION_INTERVAL_MS = 5 * 60_000

export function nextRecommendationProfileReconciliationRunAt(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + RECONCILIATION_INTERVAL_MS)
}

export async function runRecommendationProfileReconciliationFromScheduler(
  now = new Date(),
) {
  return runRecommendationProfileReconciliationBatch({}, now)
}

export async function recordRecommendationProfileReconciliationHeartbeat(
  ledgerRunId: string | undefined,
  input: {
    nextRunAt: Date
    result: Awaited<
      ReturnType<typeof runRecommendationProfileReconciliationBatch>
    > | null
  },
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      summary: `Profile eligibility reconciliation sleeping until ${input.nextRunAt.toISOString()}.`,
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
      "event=recommendation.reconciliation.heartbeat outcome=" +
        (input.result ? "completed" : "unavailable"),
    )
  } catch {
    // Observability cannot interrupt the five-minute scheduler.
  }
}

export async function ensureRecommendationProfileReconciliationSchedulerStarted(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  return { started: false }
}

export async function markRecommendationProfileReconciliationSchedulerStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}
