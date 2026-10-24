import { RetryableError } from "workflow"

export async function runPlaybackObservationSnapshotBootstrap(input: {
  ledgerRunId: string
}): Promise<void> {
  "use workflow"
  await stepMarkBootstrapStarted(input.ledgerRunId)
  let snapshotFailed = false
  let readinessFailed = false
  try {
    await stepRefreshPlaybackObservationSnapshots()
  } catch {
    snapshotFailed = true
  }
  try {
    await stepRunBootstrapPlaybackSignalReadiness()
  } catch {
    readinessFailed = true
  }
  await stepFinishBootstrap(input.ledgerRunId, snapshotFailed, readinessFailed)
  if (snapshotFailed || readinessFailed)
    throw new Error("Playback observation bootstrap incomplete")
}

async function stepMarkBootstrapStarted(ledgerRunId: string): Promise<void> {
  "use step"
  const { markWorkflowRunStarted } =
    await import("@/services/workflow-run-log.service")
  await markWorkflowRunStarted(ledgerRunId)
}

async function stepRefreshPlaybackObservationSnapshots(): Promise<void> {
  "use step"
  const { runPlaybackObservationSnapshotFromScheduler } =
    await import("@/services/recommendations/playback-observation-snapshot.job")
  const result = await runPlaybackObservationSnapshotFromScheduler()
  if (!result.ok) {
    throw new RetryableError("Playback observation snapshot bootstrap failed", {
      retryAfter: "5m",
    })
  }
}

stepRefreshPlaybackObservationSnapshots.maxRetries = 5

async function stepRunBootstrapPlaybackSignalReadiness(): Promise<void> {
  "use step"
  const { runPlaybackSignalReadinessFromScheduler } =
    await import("@/services/recommendations/playback-signal-readiness.job")
  const result = await runPlaybackSignalReadinessFromScheduler()
  if (!result.ok) {
    throw new RetryableError("Playback signal readiness bootstrap failed", {
      retryAfter: "5m",
    })
  }
}

stepRunBootstrapPlaybackSignalReadiness.maxRetries = 5

async function stepFinishBootstrap(
  ledgerRunId: string,
  snapshotFailed: boolean,
  readinessFailed: boolean,
): Promise<void> {
  "use step"
  const { prisma } = await import("@/db/client")
  const { markWorkflowRunFailed } =
    await import("@/services/workflow-run-log.service")
  if (snapshotFailed || readinessFailed) {
    await markWorkflowRunFailed(
      ledgerRunId,
      new Error("Playback observation bootstrap incomplete"),
    )
    return
  }
  await prisma.workflowRun.update({
    where: { id: ledgerRunId },
    data: {
      status: "SUCCEEDED",
      summary:
        "Playback observation snapshots and signal readiness initialized.",
      finishedAt: new Date(),
    },
  })
}
