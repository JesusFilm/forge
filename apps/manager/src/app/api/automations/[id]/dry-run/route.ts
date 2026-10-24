import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  enqueueAutomationRun,
  type AutomationRunResult,
} from "@/features/agents/automation-runner"
import {
  claimAutomationDryRun,
  completeAutomationRun,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  hasInFlightAutomationRun,
  markAutomationRunFailedIfInFlight,
  releaseAutomationDryRunClaim,
} from "@/features/agents/automation-store"
import type {
  EnrichmentAutomation,
  EnrichmentAutomationRun,
} from "@/features/agents/automation-contract"

function hasActiveLease(automation: EnrichmentAutomation, now: Date): boolean {
  if (!automation.leaseToken || !automation.leaseExpiresAt) return false
  return new Date(automation.leaseExpiresAt).getTime() > now.getTime()
}

function buildFailedResult(error: unknown): AutomationRunResult {
  const message =
    error instanceof Error ? error.message : "Automation dry run failed."
  return {
    status: "failed",
    eligibleCount: 0,
    enqueuedCount: 0,
    skippedDuplicateCount: 0,
    errorCount: 1,
    jobDocumentIds: [],
    errors: [message],
    summary: "Automation dry run failed.",
  }
}

function isTerminalRun(
  run: EnrichmentAutomationRun | null,
): run is EnrichmentAutomationRun {
  return (
    run?.status === "success" ||
    run?.status === "partial" ||
    run?.status === "failed" ||
    run?.status === "no_op"
  )
}

async function completeDryRunOrMarkFailed(input: {
  runDocumentId: string
  result: AutomationRunResult
  finishedAt: string
}) {
  try {
    return await completeAutomationRun(input)
  } catch (error) {
    const fallbackFinishedAt = new Date().toISOString()
    try {
      const persistedRun = await getAutomationRun(input.runDocumentId)
      if (isTerminalRun(persistedRun)) {
        return persistedRun
      }
    } catch (readError) {
      console.error(
        "[api/automations/dry-run] Failed to read dry run before failure fallback:",
        readError,
      )
    }

    try {
      const updated = await markAutomationRunFailedIfInFlight({
        runDocumentId: input.runDocumentId,
        error:
          error instanceof Error ? error.message : "Automation dry run failed.",
        finishedAt: fallbackFinishedAt,
      })
      if (!updated) {
        const persistedRun = await getAutomationRun(input.runDocumentId)
        if (isTerminalRun(persistedRun)) {
          return persistedRun
        }
      }
    } catch (fallbackError) {
      console.error(
        "[api/automations/dry-run] Failed to mark stranded dry run as failed:",
        fallbackError,
      )
    }
    throw error
  }
}

async function releaseDryRunClaim(input: {
  automationDocumentId: string
  leaseToken: string
}) {
  try {
    await releaseAutomationDryRunClaim(
      input.automationDocumentId,
      input.leaseToken,
    )
  } catch (error) {
    console.error(
      "[api/automations/dry-run] Failed to release manual dry-run lease:",
      error,
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await context.params
  const now = new Date()
  const nowIso = now.toISOString()
  let dryRunClaim: { documentId: string; leaseToken: string } | null = null

  try {
    const automation = await getAutomation(id)
    if (!automation) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 },
      )
    }

    if (
      hasActiveLease(automation, now) ||
      (await hasInFlightAutomationRun(automation.documentId))
    ) {
      return NextResponse.json(
        { error: "Automation already has a run in progress." },
        { status: 409 },
      )
    }

    dryRunClaim = await claimAutomationDryRun(automation.documentId)
    if (!dryRunClaim) {
      return NextResponse.json(
        { error: "Automation already has a run in progress." },
        { status: 409 },
      )
    }

    const run = await createAutomationRun({
      automationDocumentId: automation.documentId,
      runMode: "dry_run",
      scheduledFor: nowIso,
      startedAt: nowIso,
    })

    let result: AutomationRunResult
    let runnerError: unknown = null
    try {
      result = await enqueueAutomationRun({
        runDocumentId: run.documentId,
        runMode: "dry_run",
        automation,
      })
    } catch (error) {
      runnerError = error
      result = buildFailedResult(error)
    }

    const completedRun = await completeDryRunOrMarkFailed({
      runDocumentId: run.documentId,
      result,
      finishedAt: new Date().toISOString(),
    })
    const refreshedAutomation = await getAutomation(id)

    if (runnerError) {
      return NextResponse.json(
        {
          error: "Automation dry run failed.",
          automation: refreshedAutomation ?? automation,
          run: completedRun,
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      automation: refreshedAutomation ?? automation,
      run: completedRun,
    })
  } catch (error) {
    console.error("[api/automations/dry-run] Failed to run automation:", error)
    return NextResponse.json(
      { error: "Failed to run automation dry run" },
      { status: 502 },
    )
  } finally {
    if (dryRunClaim) {
      await releaseDryRunClaim({
        automationDocumentId: dryRunClaim.documentId,
        leaseToken: dryRunClaim.leaseToken,
      })
    }
  }
}
