import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  enqueueAutomationRun,
  type AutomationRunResult,
} from "@/features/agents/automation-runner"
import {
  completeAutomationRun,
  createAutomationRun,
  getAutomation,
} from "@/features/agents/automation-store"
import type { EnrichmentAutomation } from "@/features/agents/automation-contract"

function hasActiveLease(automation: EnrichmentAutomation, now: Date): boolean {
  if (!automation.leaseToken || !automation.leaseExpiresAt) return false
  return new Date(automation.leaseExpiresAt).getTime() > now.getTime()
}

function hasInFlightRun(automation: EnrichmentAutomation): boolean {
  return automation.runs.some(
    (run) => run.status === "claimed" || run.status === "running",
  )
}

function buildFailedResult(error: unknown): AutomationRunResult {
  return {
    status: "failed",
    eligibleCount: 0,
    enqueuedCount: 0,
    skippedDuplicateCount: 0,
    errorCount: 1,
    jobDocumentIds: [],
    errors: [
      error instanceof Error ? error.message : "Automation dry run failed.",
    ],
    summary: "Automation dry run failed.",
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

  try {
    const automation = await getAutomation(id)
    if (!automation) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 },
      )
    }

    if (hasActiveLease(automation, now) || hasInFlightRun(automation)) {
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

    const completedRun = await completeAutomationRun({
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
  }
}
