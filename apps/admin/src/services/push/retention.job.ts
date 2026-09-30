import { WorkflowRunStatus } from "@prisma/client"

import { prisma } from "@/db/client"
import {
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"

import {
  purgeExpiredPushRows,
  PUSH_RETENTION_WORKFLOW_KEY,
  type PushPurgeResult,
} from "./retention.service"

export async function runPushRetentionJob(
  input: { ledgerRunId?: string } = {},
): Promise<PushPurgeResult> {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  try {
    const result = await purgeExpiredPushRows(prisma)
    if (input.ledgerRunId) {
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          summary: `Purged ${result.rowCounts.expiredDeliveries ?? 0} push delivery row(s).`,
          finishedAt: new Date(),
          details: {
            rowCounts: result.rowCounts,
            overdueAfterRun: result.overdueAfterRun,
          },
        },
      })
    }
    return result
  } catch (error) {
    if (input.ledgerRunId) {
      await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    }
    throw error
  }
}

/**
 * One purge page with its own ledger row. The push ledger key is separate from
 * the recommendation one, so an operator can tell the two purges apart and a
 * push failure never marks the privacy purge failed.
 */
export async function runPushRetentionFromScheduler(): Promise<{
  ok: boolean
  ledgerRunId: string
  result?: PushPurgeResult
  error?: string
}> {
  const ledger = await createWorkflowRunLog({
    workflowKey: PUSH_RETENTION_WORKFLOW_KEY,
    workflowName: "Push Retention",
    trigger: "scheduled",
    subjectType: "push-delivery",
    subjectId: "expired-rows",
    summary: "Push retention purge started by scheduler.",
    details: { retention: "push-rows" },
  })
  try {
    const result = await runPushRetentionJob({ ledgerRunId: ledger.id })
    return { ok: true, ledgerRunId: ledger.id, result }
  } catch (error) {
    return {
      ok: false,
      ledgerRunId: ledger.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
