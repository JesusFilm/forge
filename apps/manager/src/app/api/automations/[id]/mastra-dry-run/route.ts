import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { env } from "@/config/env"
import {
  enqueueAutomationRun,
  type AutomationRunResult,
} from "@/features/agents/automation-runner"
import {
  isCreatableAutomationTemplate,
  type EnrichmentAutomation,
  type EnrichmentAutomationRun,
} from "@/features/agents/automation-contract"
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
import { z } from "zod"

const mastraDryRunRequestSchema = z
  .object({
    runMode: z.enum(["dry_run", "live"]).optional(),
    requestedBy: z
      .object({
        kind: z.enum(["manager_user", "service"]),
        id: z.string().trim().min(1).max(160),
      })
      .optional(),
    idempotencyKey: z.string().trim().min(1).max(240).optional(),
  })
  .strict()

function jsonError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status })
}

function hasActiveLease(automation: EnrichmentAutomation, now: Date): boolean {
  if (!automation.leaseToken || !automation.leaseExpiresAt) return false
  return new Date(automation.leaseExpiresAt).getTime() > now.getTime()
}

function isValidMastraServiceRequest(request: Request): boolean {
  const apiKey = env.MANAGER_MASTRA_API_KEY
  const authHeader = request.headers.get("authorization")
  if (!apiKey || !authHeader?.startsWith("Bearer ")) {
    return false
  }

  const token = authHeader.slice(7)
  const a = Buffer.from(token)
  const b = Buffer.from(apiKey)
  return a.length === b.length && timingSafeEqual(a, b)
}

function buildFailedResult(error: unknown): AutomationRunResult {
  const message =
    error instanceof Error ? error.message : "Mastra automation dry run failed."
  return {
    status: "failed",
    eligibleCount: 0,
    enqueuedCount: 0,
    skippedDuplicateCount: 0,
    errorCount: 1,
    jobDocumentIds: [],
    errors: [message],
    summary: "Mastra automation dry run failed.",
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
        "[api/automations/mastra-dry-run] Failed to read dry run before failure fallback:",
        readError,
      )
    }

    try {
      const updated = await markAutomationRunFailedIfInFlight({
        runDocumentId: input.runDocumentId,
        error:
          error instanceof Error
            ? error.message
            : "Mastra automation dry run failed.",
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
        "[api/automations/mastra-dry-run] Failed to mark stranded dry run as failed:",
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
      "[api/automations/mastra-dry-run] Failed to release dry-run lease:",
      error,
    )
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isValidMastraServiceRequest(request)) {
    return jsonError(
      "service_bearer_required",
      "Mastra service bearer token required",
      403,
    )
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    return jsonError(
      "invalid_automation",
      "Request body must be valid JSON.",
      400,
    )
  }

  const parsed = mastraDryRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(
      "invalid_automation",
      "Mastra automation dry-run request is invalid.",
      400,
    )
  }
  if (parsed.data.runMode === "live") {
    return jsonError(
      "invalid_automation",
      "Mastra automation requests are dry-run only.",
      400,
    )
  }

  const { id } = await context.params
  const now = new Date()
  const nowIso = now.toISOString()
  let dryRunClaim: { documentId: string; leaseToken: string } | null = null

  try {
    const automation = await getAutomation(id)
    if (!automation) {
      return jsonError("not_found", "Automation not found", 404)
    }

    if (!isCreatableAutomationTemplate(automation.template)) {
      return jsonError(
        "invalid_automation",
        "Automation template is not available for Mastra dry runs.",
        400,
      )
    }

    if (
      hasActiveLease(automation, now) ||
      (await hasInFlightAutomationRun(automation.documentId))
    ) {
      return jsonError(
        "run_in_progress",
        "Automation already has a run in progress.",
        409,
      )
    }

    dryRunClaim = await claimAutomationDryRun(automation.documentId)
    if (!dryRunClaim) {
      return jsonError(
        "run_in_progress",
        "Automation already has a run in progress.",
        409,
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

    if (runnerError) {
      return NextResponse.json(
        {
          ok: false,
          code: "dry_run_failed",
          message: "Mastra automation dry run failed.",
          data: {
            automationDocumentId: automation.documentId,
            run: completedRun,
          },
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      automationDocumentId: automation.documentId,
      managerAutomationRunDocumentId: completedRun.documentId,
      status: completedRun.status,
      summary: completedRun.summary ?? result.summary,
      reportUrl: `/dashboard/agents?automationId=${encodeURIComponent(
        automation.documentId,
      )}&runId=${encodeURIComponent(completedRun.documentId)}`,
      report: completedRun.report ?? result.dryRunReport,
    })
  } catch (error) {
    console.error(
      "[api/automations/mastra-dry-run] Failed to run automation:",
      error,
    )
    return jsonError(
      "dry_run_failed",
      "Failed to run Mastra automation dry run.",
      502,
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
