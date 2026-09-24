import { WorkflowRunStatus } from "@prisma/client"
import { start } from "workflow/api"
import { prisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { runPlaybackObservationSnapshotBootstrap } from "@/workflows/playbackObservationSnapshotBootstrap"
import {
  PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS,
  PLAYBACK_OBSERVATION_SNAPSHOT_VERSION,
  refreshPlaybackObservationSnapshots,
} from "./admin-ops/playback-observation-snapshot"

export const PLAYBACK_OBSERVATION_SNAPSHOT_WORKFLOW_KEY =
  "playback-observation-snapshot"
export const PLAYBACK_OBSERVATION_SNAPSHOT_BOOTSTRAP_KEY =
  "playback-observation-snapshot-bootstrap"
const BOOTSTRAP_LOCK_ID = 370_000_020
const DAY_MS = 86_400_000

export async function runPlaybackObservationSnapshotFromScheduler(
  now: Date = new Date(),
): Promise<{ ok: boolean; ledgerRunId: string; failed: string[] }> {
  const ledger = await createWorkflowRunLog({
    workflowKey: PLAYBACK_OBSERVATION_SNAPSHOT_WORKFLOW_KEY,
    workflowName: "Playback Observation Snapshots",
    trigger: "scheduled",
    subjectType: "playback-observation",
    subjectId: "aggregate-windows",
    summary: "Playback observation windows refresh started.",
    details: { presets: PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS },
  })
  await markWorkflowRunStarted(ledger.id)
  try {
    const result = await refreshPlaybackObservationSnapshots(prisma, now)
    if (result.failed.length > 0) {
      await markWorkflowRunFailed(
        ledger.id,
        new Error(
          `Playback observation snapshot refresh failed: ${result.failed.join(", ")}`,
        ),
      )
      return { ok: false, ledgerRunId: ledger.id, failed: result.failed }
    }
    await prisma.workflowRun.update({
      where: { id: ledger.id },
      data: {
        status: WorkflowRunStatus.SUCCEEDED,
        summary: "Playback observation windows refreshed.",
        finishedAt: new Date(),
        details: {
          presets: PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS,
          refreshed: result.refreshed,
          windowEnd: now.toISOString(),
        },
      },
    })
    return { ok: true, ledgerRunId: ledger.id, failed: [] }
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    return {
      ok: false,
      ledgerRunId: ledger.id,
      failed: [...PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS],
    }
  }
}

/** A versioned one-off startup path also works when the daily loop survives a deploy. */
export async function ensurePlaybackObservationSnapshotBootstrapStarted(): Promise<{
  started: boolean
  ledgerRunId?: string
}> {
  const now = new Date()
  const reservation = await prisma.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${BOOTSTRAP_LOCK_ID}) AS locked
    `
    if (!lock[0]?.locked) return { started: false as const }
    const snapshots =
      await tx.recommendationPlaybackObservationSnapshot.findMany({
        select: {
          preset: true,
          schemaVersion: true,
          computedAt: true,
          payload: true,
          lastErrorCode: true,
        },
      })
    const snapshotsFresh = PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS.every(
      (preset) =>
        snapshots.some(
          (snapshot) =>
            snapshot.preset === preset &&
            snapshot.schemaVersion === PLAYBACK_OBSERVATION_SNAPSHOT_VERSION &&
            snapshot.lastErrorCode == null &&
            snapshot.payload != null &&
            snapshot.computedAt != null &&
            now.getTime() - snapshot.computedAt.getTime() < DAY_MS,
        ),
    )
    const readiness = await tx.recommendationPlaybackSignalReadiness.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      select: { family: true },
    })
    const readinessFresh = ["navigation", "qoe"].every((family) =>
      readiness.some((row) => row.family === family),
    )
    if (snapshotsFresh && readinessFresh) return { started: false as const }
    const existing = await tx.workflowRun.findFirst({
      where: {
        workflowKey: PLAYBACK_OBSERVATION_SNAPSHOT_BOOTSTRAP_KEY,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
        updatedAt: { gte: new Date(now.getTime() - 60 * 60 * 1_000) },
      },
      select: { id: true },
    })
    if (existing) return { started: false as const, ledgerRunId: existing.id }
    const ledger = await createWorkflowRunLog(
      {
        workflowKey: PLAYBACK_OBSERVATION_SNAPSHOT_BOOTSTRAP_KEY,
        workflowName: "Playback Observation Snapshot Bootstrap",
        trigger: "system",
        subjectType: "playback-observation",
        subjectId: "aggregate-windows",
        summary: "Missing or stale playback observation snapshots queued.",
        details: { presets: PLAYBACK_OBSERVATION_SNAPSHOT_PRESETS },
      },
      tx,
    )
    return { started: true as const, ledgerRunId: ledger.id }
  })
  if (!reservation.started) return reservation
  try {
    const runtime = await start(runPlaybackObservationSnapshotBootstrap, [
      { ledgerRunId: reservation.ledgerRunId },
    ])
    await attachWorkflowRuntimeRunId(
      reservation.ledgerRunId,
      runtime.runId,
    ).catch(() => {})
    return reservation
  } catch (error) {
    await markWorkflowRunFailed(reservation.ledgerRunId, error).catch(() => {})
    throw error
  }
}
