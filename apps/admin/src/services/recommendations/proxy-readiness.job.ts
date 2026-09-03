import { WorkflowRunStatus } from "@prisma/client"
import { prisma } from "@/db/client"
import {
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { ACTIVE_WATCH_PROXY_VERSION } from "./contracts"
import { createPlaybackProxyReadinessService } from "./proxy-readiness.service"

export const PLAYBACK_PROXY_READINESS_WORKFLOW_KEY = "playback-proxy-readiness"
const MATURITY_LAG_HOURS = 6
const EVIDENCE_WINDOW_DAYS = 7
const DAY_MS = 86_400_000

export function resolvePlaybackProxyReadinessWindow(now: Date = new Date()) {
  const windowEnd = new Date(now)
  windowEnd.setUTCMinutes(0, 0, 0)
  windowEnd.setUTCHours(windowEnd.getUTCHours() - MATURITY_LAG_HOURS)
  return {
    windowStart: new Date(windowEnd.getTime() - EVIDENCE_WINDOW_DAYS * DAY_MS),
    windowEnd,
  }
}

export async function runPlaybackProxyReadinessJob(input: {
  ledgerRunId: string
  windowStart: string
  windowEnd: string
}) {
  await markWorkflowRunStarted(input.ledgerRunId)
  try {
    const evaluation = await createPlaybackProxyReadinessService(
      prisma,
    ).evaluate({
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
    })
    await prisma.workflowRun.update({
      where: { id: input.ledgerRunId },
      data: {
        status: WorkflowRunStatus.SUCCEEDED,
        summary: `Playback proxy readiness ${evaluation.decision} at revision ${evaluation.revision}.`,
        finishedAt: new Date(),
        details: {
          proxyVersion: ACTIVE_WATCH_PROXY_VERSION,
          evaluationId: evaluation.id,
          revision: evaluation.revision,
          decision: evaluation.decision,
          rankingInfluence: false,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          evaluationPlane: "offline",
        },
      },
    })
    return evaluation
  } catch (error) {
    await markWorkflowRunFailed(input.ledgerRunId, error).catch(() => {})
    throw error
  }
}

export async function runPlaybackProxyReadinessFromScheduler(
  now: Date = new Date(),
): Promise<{ ok: boolean; ledgerRunId: string; error?: string }> {
  const window = resolvePlaybackProxyReadinessWindow(now)
  const ledger = await createWorkflowRunLog({
    workflowKey: PLAYBACK_PROXY_READINESS_WORKFLOW_KEY,
    workflowName: "Playback Proxy Readiness",
    trigger: "scheduled",
    subjectType: "playback-proxy",
    subjectId: ACTIVE_WATCH_PROXY_VERSION,
    summary: "Playback proxy readiness evaluation started.",
    details: {
      proxyVersion: ACTIVE_WATCH_PROXY_VERSION,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      evaluationPlane: "offline",
      rankingInfluence: false,
    },
  })
  try {
    await runPlaybackProxyReadinessJob({
      ledgerRunId: ledger.id,
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
