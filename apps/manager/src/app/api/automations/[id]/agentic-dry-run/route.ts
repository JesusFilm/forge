import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateAutomationDryRunServiceRequest } from "@/lib/auth"
import { readAutomationJson } from "@/lib/automation-dry-run-http"
import {
  AutomationDryRunError,
  executeAutomationDryRun,
} from "@/features/agents/automation-dry-run"

const requestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(240),
    // Attribution from an authenticated service is diagnostic metadata, never authority.
    requestedBy: z
      .object({
        kind: z.enum(["manager_user", "service"]),
        id: z.string().trim().min(1).max(160),
      })
      .strict()
      .optional(),
  })
  .strict()
const failure = (code: string, message: string, status: number) =>
  NextResponse.json({ ok: false, code, message }, { status })

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = authenticateAutomationDryRunServiceRequest(request)
  if (denied) return denied
  const parsed = requestSchema.safeParse(await readAutomationJson(request))
  if (!parsed.success)
    return failure("invalid_automation", "Invalid dry-run request.", 400)
  const headerKey = request.headers.get("idempotency-key")
  if (headerKey !== null && headerKey !== parsed.data.idempotencyKey) {
    return failure("invalid_automation", "Idempotency keys must match.", 400)
  }
  const { id } = await context.params
  if (!id || id.length > 160)
    return failure("invalid_automation", "Invalid automation identity.", 400)
  try {
    const { run } = await executeAutomationDryRun(
      id,
      parsed.data.idempotencyKey,
    )
    if (
      run.runMode !== "dry_run" ||
      run.enqueuedCount !== 0 ||
      run.jobDocumentIds.length !== 0 ||
      !["success", "partial", "failed", "no_op"].includes(run.status)
    ) {
      return failure("manager_unavailable", "Invalid dry-run result.", 502)
    }
    // Keep the service envelope small; the full durable report is in Manager.
    return NextResponse.json({
      ok: true,
      automationDocumentId: id,
      managerAutomationRunDocumentId: run.documentId,
      runMode: "dry_run",
      enqueuedCount: 0,
      status: run.status,
      summary: (run.summary ?? "Dry run complete.").slice(0, 2_000),
      reportUrl: `/dashboard/agents?automationId=${encodeURIComponent(id)}&runId=${encodeURIComponent(run.documentId)}`,
    })
  } catch (error) {
    if (error instanceof AutomationDryRunError)
      return failure(error.code, error.message, error.status)
    return failure(
      "manager_unavailable",
      "Automation dry run could not be completed.",
      502,
    )
  }
}
