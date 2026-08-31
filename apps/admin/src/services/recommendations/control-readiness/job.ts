import { type Prisma, WorkflowRunStatus } from "@prisma/client"
import type { WorkflowRunStatus as RuntimeWorkflowRunStatus } from "@workflow/world"
import { start } from "workflow/api"
import { getWorld } from "workflow/runtime"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { RECOMMENDATION_SERVING_CONTROL_ID } from "../manifest.service"
import { createRecommendationControlReadinessService } from "./service"
import { RECOMMENDATION_CONTROL_READINESS_POLICY } from "./policy"
import { runRecommendationControlReadinessScheduler } from "@/workflows/recommendationControlReadiness"

export const RECOMMENDATION_CONTROL_READINESS_WORKFLOW_KEY =
  "recommendation-control-readiness"
export const RECOMMENDATION_CONTROL_READINESS_SCHEDULER_WORKFLOW_KEY =
  "recommendation-control-readiness-scheduler"
const SCHEDULER_LOCK_ID = 381_000_002
const SCHEDULER_FRESH_MS = 36 * 60 * 60 * 1_000
const MATURITY_LAG_HOURS = 6
const EVALUATION_HOUR_UTC = 11
const DAY_MS = 86_400_000
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

type RuntimeRunStatus = {
  status: RuntimeWorkflowRunStatus
  error: string | null
}

async function loadRuntimeRunStatus(
  runtimeRunId: string,
): Promise<RuntimeRunStatus | null> {
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
    return {
      status: run.status,
      error: run.error?.message ?? null,
    }
  } catch {
    // Preserve an active public ledger when the runtime state is unavailable;
    // a duplicate infinite scheduler is more dangerous than delayed repair.
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function reconcileTerminalSchedulerRuntime(
  tx: Prisma.TransactionClient,
  existing: { id: string; runtimeRunId: string | null },
  runtimeRun: RuntimeRunStatus,
): Promise<boolean> {
  if (!existing.runtimeRunId) return false

  const ledgerStatus = RUNTIME_TO_LEDGER_STATUS[runtimeRun.status]
  if (!ledgerStatus) return false

  await tx.workflowRun.update({
    where: { id: existing.id },
    data: {
      status: ledgerStatus,
      summary: `Semantic control readiness scheduler runtime ${runtimeRun.status}.`,
      error: runtimeRun.error,
      finishedAt: new Date(),
    },
  })
  return true
}

export type RecommendationControlReadinessJobInput = Readonly<{
  ledgerRunId?: string
  expectedServingControlVersion: number
  expectedManifestId: string
  windowStart: string
  windowEnd: string
}>

export function resolveRecommendationControlWindow(now: Date = new Date()) {
  const windowEnd = new Date(now)
  windowEnd.setUTCMinutes(0, 0, 0)
  windowEnd.setUTCHours(windowEnd.getUTCHours() - MATURITY_LAG_HOURS)
  return {
    windowStart: new Date(
      windowEnd.getTime() -
        RECOMMENDATION_CONTROL_READINESS_POLICY.evidenceWindowDays * DAY_MS,
    ),
    windowEnd,
  }
}

export function nextRecommendationControlReadinessRunAt(
  now: Date = new Date(),
): Date {
  const next = new Date(now)
  next.setUTCHours(EVALUATION_HOUR_UTC, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export async function runRecommendationControlReadinessJob(
  input: RecommendationControlReadinessJobInput,
) {
  if (input.ledgerRunId) await markWorkflowRunStarted(input.ledgerRunId)
  try {
    const result = await createRecommendationControlReadinessService(
      prisma,
    ).evaluate({
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      expectedServingControlVersion: input.expectedServingControlVersion,
      expectedManifestId: input.expectedManifestId,
    })
    if (input.ledgerRunId) {
      const published = result.status !== "fenced"
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: published
            ? WorkflowRunStatus.SUCCEEDED
            : WorkflowRunStatus.SKIPPED,
          summary: published
            ? `Semantic control readiness ${result.status} at revision ${result.revision}.`
            : `Semantic control readiness fenced: ${result.reason}.`,
          finishedAt: new Date(),
          details: {
            expectedServingControlVersion: input.expectedServingControlVersion,
            expectedManifestId: input.expectedManifestId,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            result: result.status,
            ...(published
              ? {
                  evaluationId: result.evaluationId,
                  revision: result.revision,
                  state: result.state,
                }
              : { reason: result.reason }),
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

export async function runRecommendationControlReadinessFromScheduler(
  input: { now?: Date } = {},
): Promise<{
  ok: boolean
  ledgerRunId: string
  error?: string
}> {
  const now = input.now ?? new Date()
  const control = await prisma.recommendationServingControl.findUnique({
    where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
    select: { version: true, manifestId: true },
  })
  const window = resolveRecommendationControlWindow(now)
  const ledger = await createWorkflowRunLog({
    workflowKey: RECOMMENDATION_CONTROL_READINESS_WORKFLOW_KEY,
    workflowName: "Semantic Control Readiness",
    trigger: "scheduled",
    subjectType: "recommendation-strategy-manifest",
    subjectId: control?.manifestId ?? "missing",
    summary: control
      ? "Semantic control readiness evaluation started."
      : "Semantic control readiness evaluation skipped: serving control missing.",
    details: {
      expectedServingControlVersion: control?.version ?? null,
      expectedManifestId: control?.manifestId ?? null,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      evaluationPlane: "offline",
    },
  })
  if (!control) {
    await prisma.workflowRun.update({
      where: { id: ledger.id },
      data: {
        status: WorkflowRunStatus.SKIPPED,
        summary:
          "Semantic control readiness evaluation skipped: serving control missing.",
        finishedAt: now,
        details: {
          reason: "serving_control_missing",
          windowStart: window.windowStart.toISOString(),
          windowEnd: window.windowEnd.toISOString(),
        },
      },
    })
    return {
      ok: false,
      ledgerRunId: ledger.id,
      error: "serving_control_missing",
    }
  }
  try {
    await runRecommendationControlReadinessJob({
      ledgerRunId: ledger.id,
      expectedServingControlVersion: control.version,
      expectedManifestId: control.manifestId,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
    })
    return { ok: true, ledgerRunId: ledger.id }
  } catch (error) {
    return {
      ok: false,
      ledgerRunId: ledger.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function recordRecommendationControlReadinessSchedulerHeartbeat(
  ledgerRunId: string | undefined,
  nextRunAt: Date,
): Promise<void> {
  if (!ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      summary: `Semantic control readiness scheduler sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: "daily 11:00 UTC",
        evaluationPlane: "offline",
      },
    },
  })
}

export async function ensureRecommendationControlReadinessSchedulerStarted(): Promise<{
  started: boolean
  runId?: string
  ledgerRunId?: string
}> {
  const freshnessCutoff = new Date(Date.now() - SCHEDULER_FRESH_MS)
  const inspectedLedger = await prisma.workflowRun.findFirst({
    where: {
      workflowKey: RECOMMENDATION_CONTROL_READINESS_SCHEDULER_WORKFLOW_KEY,
      status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      updatedAt: { gte: freshnessCutoff },
    },
    orderBy: { updatedAt: "desc" },
  })
  const inspectedRuntime = inspectedLedger?.runtimeRunId
    ? await loadRuntimeRunStatus(inspectedLedger.runtimeRunId)
    : null

  const reservation = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_ID}) AS locked
    `
    if (!lock[0]?.locked) return { started: false as const }
    const existing = await tx.workflowRun.findFirst({
      where: {
        workflowKey: RECOMMENDATION_CONTROL_READINESS_SCHEDULER_WORKFLOW_KEY,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
        updatedAt: { gte: freshnessCutoff },
      },
      orderBy: { updatedAt: "desc" },
    })
    if (existing) {
      const terminal =
        inspectedLedger?.id === existing.id &&
        inspectedLedger.runtimeRunId === existing.runtimeRunId &&
        inspectedRuntime != null
          ? await reconcileTerminalSchedulerRuntime(
              tx,
              existing,
              inspectedRuntime,
            )
          : false
      if (!terminal) {
        return { started: false as const, ledgerRunId: existing.id }
      }
    }
    const ledger = await createWorkflowRunLog(
      {
        workflowKey: RECOMMENDATION_CONTROL_READINESS_SCHEDULER_WORKFLOW_KEY,
        workflowName: "Semantic Control Readiness Scheduler",
        trigger: "scheduled",
        subjectType: "recommendation-control",
        subjectId: "semantic",
        summary: "Semantic control readiness scheduler queued.",
        details: {
          schedule: "daily 11:00 UTC",
          evaluationPlane: "offline",
        },
      },
      tx,
    )
    return { started: true as const, ledger }
  })
  if (!reservation.started) return reservation
  let runtime: Awaited<ReturnType<typeof start>>
  try {
    runtime = await start(runRecommendationControlReadinessScheduler, [
      { ledgerRunId: reservation.ledger.id },
    ])
  } catch (error) {
    await markWorkflowRunFailed(reservation.ledger.id, error).catch(() => {})
    throw error
  }
  await attachWorkflowRuntimeRunId(reservation.ledger.id, runtime.runId).catch(
    () => {
      console.warn(
        "Recommendation control-readiness scheduler started before its runtime identity could be recorded; workflow self-reconciliation will retry.",
      )
    },
  )
  return {
    started: true,
    runId: runtime.runId,
    ledgerRunId: reservation.ledger.id,
  }
}

export async function markRecommendationControlReadinessSchedulerRuntimeStarted(
  ledgerRunId: string | undefined,
  runtimeRunId: string,
): Promise<void> {
  if (!ledgerRunId) return
  await markWorkflowRunRuntimeStarted(ledgerRunId, runtimeRunId)
}
