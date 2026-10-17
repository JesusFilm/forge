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
import { runRecommendationCowatchRefreshScheduler } from "@/workflows/recommendationCowatchRefresh"
import { RecommendationCowatchRefreshService } from "./refresh.service"

export const RECOMMENDATION_COWATCH_REFRESH_SCHEDULER_WORKFLOW_KEY =
  "recommendation-cowatch-refresh-scheduler"
const SCHEDULER_LOCK_ID = 573_000_002
const SCHEDULER_FRESH_MS = 15 * 60_000
const REFRESH_CHECK_INTERVAL_MS = 5 * 60_000
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
  const freshnessCutoff = new Date(Date.now() - SCHEDULER_FRESH_MS)
  const inspected = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: RECOMMENDATION_COWATCH_REFRESH_SCHEDULER_WORKFLOW_KEY,
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
        workflowKey: RECOMMENDATION_COWATCH_REFRESH_SCHEDULER_WORKFLOW_KEY,
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
            summary: `Co-watch refresh scheduler runtime ${matchingRuntime?.status}.`,
            error: matchingRuntime?.error ?? null,
            finishedAt: new Date(),
          },
        })
      }
    }

    const ledger = await createWorkflowRunLog(
      {
        workflowKey: RECOMMENDATION_COWATCH_REFRESH_SCHEDULER_WORKFLOW_KEY,
        workflowName: "Co-watch Refresh Scheduler",
        trigger: "scheduled",
        subjectType: "recommendation-cowatch",
        subjectId: "owner-refresh",
        summary: "Co-watch refresh scheduler queued.",
        details: {
          schedule: "every 5 minutes",
          boundedPolicy: "cowatch-refresh-seven-day-mature-v1",
        },
      },
      tx,
    )
    return { started: true as const, ledger }
  })

  if (!reservation.started) return reservation
  let workflow: Awaited<ReturnType<typeof start>>
  try {
    workflow = await start(runRecommendationCowatchRefreshScheduler, [
      { ledgerRunId: reservation.ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(reservation.ledger.id, error).catch(() => {})
    throw error
  }
  await attachWorkflowRuntimeRunId(reservation.ledger.id, workflow.runId).catch(
    () => {
      console.warn(
        "Co-watch refresh scheduler started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
      )
    },
  )
  return {
    started: true,
    runId: workflow.runId,
    ledgerRunId: reservation.ledger.id,
  }
}

export async function markRecommendationCowatchRefreshSchedulerStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}
