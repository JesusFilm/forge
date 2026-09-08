import { WorkflowRunStatus } from "@prisma/client"
import type { WorkflowRunStatus as RuntimeWorkflowRunStatus } from "@workflow/world"
import { start } from "workflow/api"
import { getWorld } from "workflow/runtime"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
} from "@/services/workflow-run-log.service"
import { runRecommendationProfileReconciliationScheduler } from "@/workflows/recommendationProfileReconciliation"
import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"

export const RECOMMENDATION_PROFILE_RECONCILIATION_SCHEDULER_WORKFLOW_KEY =
  "recommendation-profile-reconciliation-scheduler"
const SCHEDULER_LOCK_ID = 459_000_001
const SCHEDULER_FRESH_MS = 15 * 60_000
const RECONCILIATION_INTERVAL_MS = 5 * 60_000
const RUNTIME_STATUS_LOOKUP_DEADLINE_MS = 1_000

const RUNTIME_TO_LEDGER_STATUS: Readonly<
  Record<RuntimeWorkflowRunStatus, WorkflowRunStatus | null>
> = {
  pending: null,
  running: null,
  completed: WorkflowRunStatus.SUCCEEDED,
  failed: WorkflowRunStatus.FAILED,
  cancelled: WorkflowRunStatus.CANCELLED,
}

async function loadRuntimeStatus(runtimeRunId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = await Promise.race([
      getWorld().runs.get(runtimeRunId, { resolveData: "none" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("workflow runtime lookup timed out")),
          RUNTIME_STATUS_LOOKUP_DEADLINE_MS,
        )
      }),
    ])
    return { status: run.status, error: run.error?.message ?? null }
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
}

export async function ensureRecommendationProfileReconciliationSchedulerStarted(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  const freshnessCutoff = new Date(Date.now() - SCHEDULER_FRESH_MS)
  const inspected = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: RECOMMENDATION_PROFILE_RECONCILIATION_SCHEDULER_WORKFLOW_KEY,
      status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
    },
    orderBy: { updatedAt: "desc" },
  })
  const runtime = inspected?.runtimeRunId
    ? await loadRuntimeStatus(inspected.runtimeRunId)
    : null

  const reservation = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_ID}) AS locked
    `
    if (!lock[0]?.locked) return { started: false as const }

    const existing = await tx.workflowRun.findFirst({
      where: {
        workflowKey:
          RECOMMENDATION_PROFILE_RECONCILIATION_SCHEDULER_WORKFLOW_KEY,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      },
      orderBy: { updatedAt: "desc" },
    })
    if (existing) {
      const matchingRuntime =
        inspected?.id === existing.id &&
        inspected.runtimeRunId === existing.runtimeRunId &&
        runtime != null
          ? runtime
          : null
      const terminal = matchingRuntime
        ? RUNTIME_TO_LEDGER_STATUS[matchingRuntime.status]
        : null
      if (!terminal) {
        const runtimeIsActive =
          matchingRuntime?.status === "pending" ||
          matchingRuntime?.status === "running"
        if (existing.updatedAt >= freshnessCutoff || runtimeIsActive) {
          return { started: false as const, ledgerRunId: existing.id }
        }
      }
      if (terminal) {
        await tx.workflowRun.update({
          where: { id: existing.id },
          data: {
            status: terminal,
            summary: `Profile eligibility reconciliation scheduler runtime ${matchingRuntime?.status}.`,
            error: matchingRuntime?.error ?? null,
            finishedAt: new Date(),
          },
        })
      }
    }

    const ledger = await createWorkflowRunLog(
      {
        workflowKey:
          RECOMMENDATION_PROFILE_RECONCILIATION_SCHEDULER_WORKFLOW_KEY,
        workflowName: "Profile Eligibility Reconciliation Scheduler",
        trigger: "scheduled",
        subjectType: "recommendation-profile",
        subjectId: "eligibility",
        summary: "Profile eligibility reconciliation scheduler queued.",
        details: { schedule: "every 5 minutes", batchSize: 100 },
      },
      tx,
    )
    return { started: true as const, ledger }
  })

  if (!reservation.started) return reservation
  let workflow: Awaited<ReturnType<typeof start>>
  try {
    workflow = await start(runRecommendationProfileReconciliationScheduler, [
      { ledgerRunId: reservation.ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(reservation.ledger.id, error).catch(() => {})
    throw error
  }
  await attachWorkflowRuntimeRunId(reservation.ledger.id, workflow.runId).catch(
    () => {
      console.warn(
        "Profile eligibility reconciliation scheduler started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
      )
    },
  )
  return {
    started: true,
    runId: workflow.runId,
    ledgerRunId: reservation.ledger.id,
  }
}

export async function markRecommendationProfileReconciliationSchedulerStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}
