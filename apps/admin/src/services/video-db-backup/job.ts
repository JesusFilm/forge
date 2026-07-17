import { Prisma, WorkflowRunStatus } from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import {
  SCHEDULED_VIDEO_DB_BACKUP_PROFILES,
  runScheduledVideoDbBackup,
  type VideoDbBackupJobResult,
  type VideoDbBackupProfile,
} from "@/scripts/video-db-backup"
import {
  runVideoDbBackup,
  runVideoDbBackupScheduler,
} from "@/workflows/videoDbBackup"

export type VideoDbBackupTrigger = "scheduled"
export type VideoDbBackupSchedulerInput = {
  ledgerRunId?: string
}

export type VideoDbBackupWorkflowInput = {
  trigger?: VideoDbBackupTrigger
  ledgerRunId?: string
  profile?: VideoDbBackupProfile
}

export type VideoDbBackupDispatchResult = {
  workflow: "video-db-backup"
  runId: string
  trigger: VideoDbBackupTrigger
  status: "queued"
}

export type VideoDbBackupSchedulerStartResult =
  | {
      started: true
      runId: string
      ledgerRunId: string
    }
  | {
      started: false
      reason: "already-running" | "lock-not-acquired"
      ledgerRunId?: string
      runtimeRunId?: string | null
    }

export type VideoDbBackupSchedulerRunResult = {
  ok: boolean
  ledgerRunId: string
  result?: VideoDbBackupJobResult
  error?: string
}

const SCHEDULER_WORKFLOW_KEY = "video-db-backup-scheduler"
const SCHEDULER_LOCK_ID = 862_640_122
const BACKUP_HOUR_UTC = 9
const TERMINAL_RUNTIME_STATUSES = new Set(["completed", "failed", "cancelled"])

type SchedulerLedgerRun = {
  id: string
  runtimeRunId: string | null
}

type RuntimeRunStatus = {
  status: string
  error: string | null
}

function summarizeBackupResult(result: VideoDbBackupJobResult): string {
  const destination = result.upload
    ? `${result.upload.bucket}/${result.upload.key}`
    : result.path
  return `Backed up ${result.tables} table(s) for ${result.profile} to ${destination}.`
}

export function nextVideoDbBackupRunAt(
  now: Date = new Date(),
  hourUtc = BACKUP_HOUR_UTC,
): Date {
  const next = new Date(now)
  next.setUTCHours(hourUtc, 0, 0, 0)
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

export async function dispatchVideoDbBackup(
  input: VideoDbBackupWorkflowInput = {},
): Promise<VideoDbBackupDispatchResult> {
  const trigger = input.trigger ?? "scheduled"
  const ledgerRun = await createWorkflowRunLog({
    workflowKey: "video-db-backup",
    workflowName: "Video DB Backup",
    trigger,
    subjectType: "database",
    subjectId: "admin-video",
    summary: "Video DB backup workflow queued.",
    details: {
      profile: input.profile ?? "video-core",
      storage: "railway-s3",
    },
  })

  try {
    const run = await start(runVideoDbBackup, [
      { trigger, ledgerRunId: ledgerRun.id, profile: input.profile },
    ])
    await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)

    return {
      workflow: "video-db-backup",
      runId: run.runId,
      trigger,
      status: "queued",
    }
  } catch (error) {
    await markWorkflowRunFailed(ledgerRun.id, error).catch(() => {})
    throw error
  }
}

export async function runVideoDbBackupJob(
  input: VideoDbBackupWorkflowInput = {},
): Promise<VideoDbBackupJobResult> {
  const startedAt = Date.now()
  if (input.ledgerRunId) {
    await markWorkflowRunStarted(input.ledgerRunId)
  }

  try {
    const result = await runScheduledVideoDbBackup(input.profile)

    if (input.ledgerRunId) {
      await prisma.workflowRun.update({
        where: { id: input.ledgerRunId },
        data: {
          status: WorkflowRunStatus.SUCCEEDED,
          summary: summarizeBackupResult(result),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          details: {
            result,
          } satisfies Prisma.InputJsonValue,
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

async function runVideoDbBackupProfileFromScheduler(
  profile: VideoDbBackupProfile,
): Promise<VideoDbBackupSchedulerRunResult> {
  const ledgerRun = await createWorkflowRunLog({
    workflowKey: "video-db-backup",
    workflowName: "Video DB Backup",
    trigger: "scheduled",
    subjectType: "database",
    subjectId: "admin-video",
    summary: `Video DB ${profile} backup workflow started by scheduler.`,
    details: {
      profile,
      storage: "railway-s3",
    },
  })

  try {
    const result = await runVideoDbBackupJob({
      trigger: "scheduled",
      ledgerRunId: ledgerRun.id,
      profile,
    })
    return { ok: true, ledgerRunId: ledgerRun.id, result }
  } catch (error) {
    return {
      ok: false,
      ledgerRunId: ledgerRun.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runVideoDbBackupFromScheduler(): Promise<
  VideoDbBackupSchedulerRunResult[]
> {
  const results = []
  for (const profile of SCHEDULED_VIDEO_DB_BACKUP_PROFILES) {
    results.push(await runVideoDbBackupProfileFromScheduler(profile))
  }
  return results
}

export async function markVideoDbBackupSchedulerStarted(
  input: VideoDbBackupSchedulerInput = {},
): Promise<void> {
  if (!input.ledgerRunId) return
  await markWorkflowRunStarted(input.ledgerRunId)
}

export async function recordVideoDbBackupSchedulerHeartbeat(
  input: VideoDbBackupSchedulerInput,
  nextRunAt: Date,
): Promise<void> {
  if (!input.ledgerRunId) return
  await prisma.workflowRun.update({
    where: { id: input.ledgerRunId },
    data: {
      summary: `Video DB backup scheduler sleeping until ${nextRunAt.toISOString()}.`,
      details: {
        nextRunAt: nextRunAt.toISOString(),
        schedule: `daily ${String(BACKUP_HOUR_UTC).padStart(2, "0")}:00 UTC`,
      } satisfies Prisma.InputJsonValue,
    },
  })
}

async function withSchedulerStartLock<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SCHEDULER_LOCK_ID}) AS locked
  `
  if (!rows[0]?.locked) {
    return {
      started: false,
      reason: "lock-not-acquired",
    } as T
  }

  try {
    return await callback()
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${SCHEDULER_LOCK_ID})
    `
  }
}

async function loadRuntimeRunStatus(
  runtimeRunId: string,
): Promise<RuntimeRunStatus | null> {
  try {
    const rows = await prisma.$queryRaw<RuntimeRunStatus[]>`
      SELECT status, error
      FROM workflow.workflow_runs
      WHERE id = ${runtimeRunId}
      LIMIT 1
    `
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function reconcileStaleSchedulerRun(
  existing: SchedulerLedgerRun,
): Promise<boolean> {
  if (!existing.runtimeRunId) return false

  const runtimeRun = await loadRuntimeRunStatus(existing.runtimeRunId)
  if (!runtimeRun || !TERMINAL_RUNTIME_STATUSES.has(runtimeRun.status)) {
    return false
  }

  const status =
    runtimeRun.status === "completed"
      ? WorkflowRunStatus.SUCCEEDED
      : WorkflowRunStatus.FAILED
  const summary =
    runtimeRun.status === "completed"
      ? "Video DB backup scheduler stopped after runtime completion."
      : `Video DB backup scheduler runtime ${runtimeRun.status}.`

  await prisma.workflowRun.update({
    where: { id: existing.id },
    data: {
      status,
      finishedAt: new Date(),
      summary,
      error: runtimeRun.error,
    },
  })

  return true
}

export async function ensureVideoDbBackupSchedulerStarted(): Promise<VideoDbBackupSchedulerStartResult> {
  return withSchedulerStartLock(async () => {
    const existing = await prisma.workflowRun.findFirst({
      where: {
        workflowKey: SCHEDULER_WORKFLOW_KEY,
        status: {
          in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING],
        },
      },
      orderBy: { createdAt: "desc" },
    })

    if (existing) {
      const stale = await reconcileStaleSchedulerRun(existing)
      if (!stale) {
        return {
          started: false,
          reason: "already-running",
          ledgerRunId: existing.id,
          runtimeRunId: existing.runtimeRunId,
        }
      }
    }

    const ledgerRun = await createWorkflowRunLog({
      workflowKey: SCHEDULER_WORKFLOW_KEY,
      workflowName: "Video DB Backup Scheduler",
      trigger: "system",
      subjectType: "database",
      subjectId: "admin-video",
      summary: "Video DB backup scheduler queued.",
      details: {
        schedule: `daily ${String(BACKUP_HOUR_UTC).padStart(2, "0")}:00 UTC`,
      },
    })

    try {
      const run = await start(runVideoDbBackupScheduler, [
        { ledgerRunId: ledgerRun.id },
      ])
      await attachWorkflowRuntimeRunId(ledgerRun.id, run.runId)
      return {
        started: true,
        runId: run.runId,
        ledgerRunId: ledgerRun.id,
      }
    } catch (error) {
      await markWorkflowRunFailed(ledgerRun.id, error).catch(() => {})
      throw error
    }
  })
}
