import { WorkflowRunStatus } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { resolvePlaybackProxyReadinessWindow } from "./proxy-readiness.job"
import {
  createPlaybackSignalReadinessService,
  PLAYBACK_SIGNAL_READINESS_VERSION,
} from "./playback-signal-readiness.service"

export const PLAYBACK_SIGNAL_READINESS_WORKFLOW_KEY =
  "playback-signal-readiness"

export async function runPlaybackSignalReadinessFromScheduler(
  now: Date = new Date(),
): Promise<{ ok: boolean; ledgerRunId: string; error?: string }> {
  const window = resolvePlaybackProxyReadinessWindow(now)
  const ledger = await createWorkflowRunLog({
    workflowKey: PLAYBACK_SIGNAL_READINESS_WORKFLOW_KEY,
    workflowName: "Playback Signal Readiness",
    trigger: "scheduled",
    subjectType: "playback-signal",
    subjectId: PLAYBACK_SIGNAL_READINESS_VERSION,
    summary: "Navigation and QoE readiness evaluation started.",
    details: {
      policyVersion: PLAYBACK_SIGNAL_READINESS_VERSION,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      rankingInfluence: false,
    },
  })
  await markWorkflowRunStarted(ledger.id)
  try {
    const evaluations =
      await createPlaybackSignalReadinessService(prisma).evaluate(window)
    await prisma.workflowRun.update({
      where: { id: ledger.id },
      data: {
        status: WorkflowRunStatus.SUCCEEDED,
        summary: evaluations
          .map((evaluation) => `${evaluation.family}: ${evaluation.decision}`)
          .join("; "),
        finishedAt: new Date(),
        details: {
          policyVersion: PLAYBACK_SIGNAL_READINESS_VERSION,
          evaluationIds: evaluations.map((evaluation) => evaluation.id),
          decisions: evaluations.map((evaluation) => ({
            family: evaluation.family,
            decision: evaluation.decision,
            revision: evaluation.revision,
          })),
          rankingInfluence: false,
          windowStart: window.windowStart.toISOString(),
          windowEnd: window.windowEnd.toISOString(),
        },
      },
    })
    return { ok: true, ledgerRunId: ledger.id }
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error).catch(() => {})
    return {
      ok: false,
      ledgerRunId: ledger.id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
