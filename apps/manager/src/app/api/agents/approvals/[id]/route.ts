import { NextResponse } from "next/server"
import { authenticateManagerSessionRequest } from "@/lib/auth"
import { sharedAgentApprovalActionRequestSchema } from "@/features/agents/shared-agent-contract"
import {
  SharedAgentAccessDeniedError,
  SharedAgentApprovalAlreadyResolvedError,
  SharedAgentApprovalNotFoundError,
  resolveSharedAgentApproval,
} from "@/features/agents/shared-agent-runtime"

function readLocale(request: Request): string | undefined {
  return request.headers.get("accept-language")?.split(",")[0]?.trim()
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerSessionRequest(request)
  if (actor instanceof NextResponse) return actor

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = sharedAgentApprovalActionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  const { id } = await context.params

  try {
    const session = await resolveSharedAgentApproval({
      approvalId: id,
      action: parsed.data.action,
      actor,
      locale: readLocale(request),
    })

    return NextResponse.json({ session })
  } catch (error) {
    if (error instanceof SharedAgentApprovalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof SharedAgentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    if (error instanceof SharedAgentApprovalAlreadyResolvedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    console.error("[api/agents/approvals/:id] Approval action failed:", error)
    return NextResponse.json(
      { error: "Shared agent approval action failed" },
      { status: 502 },
    )
  }
}
