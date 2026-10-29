import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { readAutomationJson } from "@/lib/automation-dry-run-http"
import {
  AutomationDryRunError,
  executeAutomationDryRun,
} from "@/features/agents/automation-dry-run"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError
  // Existing manual callers send no body. Any explicit mode or extra fields are invalid.
  if (
    request.body &&
    !z
      .object({})
      .strict()
      .safeParse(await readAutomationJson(request)).success
  ) {
    return NextResponse.json(
      { error: "Invalid dry-run request" },
      { status: 400 },
    )
  }
  const { id } = await context.params
  try {
    const { automation, run, runnerFailed } = await executeAutomationDryRun(id)
    return NextResponse.json(
      {
        ...(runnerFailed ? { error: "Automation dry run failed." } : {}),
        automation,
        run,
      },
      { status: runnerFailed ? 502 : 200 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AutomationDryRunError
            ? error.message
            : "Failed to run automation dry run",
      },
      { status: error instanceof AutomationDryRunError ? error.status : 502 },
    )
  }
}
