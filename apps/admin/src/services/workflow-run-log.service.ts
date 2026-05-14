import {
  Prisma,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  type PrismaClient,
} from "@prisma/client"
import { prisma } from "@/db/client"
import type { SyncResult } from "@/services/core-sync/orchestrator"
import type { CoreSyncTrigger } from "@/services/core-sync/job"

type WorkflowRunClient = Pick<PrismaClient, "workflowRun" | "coreSyncRun">
export type WorkflowRunLogTrigger = CoreSyncTrigger | "system"

export type WorkflowRunLogInput = {
  workflowKey: string
  workflowName?: string
  runtimeRunId?: string
  trigger: WorkflowRunLogTrigger
  actorId?: string
  subjectType?: string
  subjectId?: string
  summary?: string
  details?: Prisma.InputJsonValue
}

const TRIGGER_MAP: Record<WorkflowRunLogTrigger, WorkflowRunTrigger> = {
  manual: WorkflowRunTrigger.MANUAL,
  scheduled: WorkflowRunTrigger.SCHEDULED,
  graphql: WorkflowRunTrigger.GRAPHQL,
  system: WorkflowRunTrigger.SYSTEM,
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function summarizeCoreSyncResult(result: SyncResult): string {
  if (result.skipped) return "Skipped because the Core sync lock was held."

  const totals = totalPhaseStats(result)
  return `${result.phases.length} phase(s), ${totals.created} created, ${totals.updated} updated, ${totals.softDeleted} soft-deleted, ${totals.errors} error(s).`
}

function totalPhaseStats(result: SyncResult) {
  return result.phases.reduce(
    (totals, phase) => ({
      created: totals.created + phase.created,
      updated: totals.updated + phase.updated,
      softDeleted: totals.softDeleted + phase.softDeleted,
      errors: totals.errors + phase.errors,
    }),
    { created: 0, updated: 0, softDeleted: 0, errors: 0 },
  )
}

export async function createWorkflowRunLog(
  input: WorkflowRunLogInput,
  client: WorkflowRunClient = prisma,
) {
  return client.workflowRun.create({
    data: {
      workflowKey: input.workflowKey,
      workflowName: input.workflowName,
      runtimeRunId: input.runtimeRunId,
      trigger: TRIGGER_MAP[input.trigger],
      actorId: input.actorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: WorkflowRunStatus.QUEUED,
      summary: input.summary,
      details: input.details ?? Prisma.JsonNull,
    },
  })
}

export async function attachWorkflowRuntimeRunId(
  workflowRunId: string,
  runtimeRunId: string,
  client: WorkflowRunClient = prisma,
) {
  return client.workflowRun.update({
    where: { id: workflowRunId },
    data: { runtimeRunId },
  })
}

export async function markWorkflowRunStarted(
  workflowRunId: string,
  client: WorkflowRunClient = prisma,
) {
  return client.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status: WorkflowRunStatus.RUNNING,
      startedAt: new Date(),
    },
  })
}

export async function markWorkflowRunFailed(
  workflowRunId: string,
  error: unknown,
  client: WorkflowRunClient = prisma,
) {
  return client.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status: WorkflowRunStatus.FAILED,
      finishedAt: new Date(),
      error: asErrorMessage(error),
    },
  })
}

export async function recordCoreSyncRunResult(
  workflowRunId: string,
  result: SyncResult,
  client: WorkflowRunClient = prisma,
) {
  const totals = totalPhaseStats(result)
  const status = result.skipped
    ? WorkflowRunStatus.SKIPPED
    : totals.errors > 0
      ? WorkflowRunStatus.FAILED
      : WorkflowRunStatus.SUCCEEDED

  await client.coreSyncRun.upsert({
    where: { workflowRunId },
    create: {
      workflowRunId,
      skippedLock: result.skipped === true,
      incremental: result.incremental,
      createdCount: totals.created,
      updatedCount: totals.updated,
      deletedCount: totals.softDeleted,
      errorCount: totals.errors,
      phaseSummary: result.phases as unknown as Prisma.InputJsonValue,
      coverageAudit:
        (result.coverageAudit as unknown as Prisma.InputJsonValue) ??
        Prisma.JsonNull,
    },
    update: {
      skippedLock: result.skipped === true,
      incremental: result.incremental,
      createdCount: totals.created,
      updatedCount: totals.updated,
      deletedCount: totals.softDeleted,
      errorCount: totals.errors,
      phaseSummary: result.phases as unknown as Prisma.InputJsonValue,
      coverageAudit:
        (result.coverageAudit as unknown as Prisma.InputJsonValue) ??
        Prisma.JsonNull,
    },
  })

  return client.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status,
      summary: summarizeCoreSyncResult(result),
      error: totals.errors > 0 ? "One or more Core sync phases failed." : null,
      finishedAt: new Date(),
      durationMs: result.durationMs,
    },
  })
}
