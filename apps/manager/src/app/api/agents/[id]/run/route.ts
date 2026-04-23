import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { sharedAgentRunRequestSchema } from "@/features/agents/shared-agent-contract"
import {
  SharedAgentNotFoundError,
  SharedAgentValidationError,
  runSharedAgent,
} from "@/features/agents/shared-agent-runtime"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

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

  const parsed = sharedAgentRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".")
      return path ? `${path}: ${issue.message}` : issue.message
    })

    return NextResponse.json(
      { error: "Validation failed", details },
      { status: 400 },
    )
  }

  const { id } = await context.params

  try {
    const result = await runSharedAgent({ agentId: id, payload: parsed.data })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SharedAgentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof SharedAgentValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400 },
      )
    }

    console.error("[api/agents/run] Shared agent execution failed:", error)
    return NextResponse.json(
      {
        error: "Shared agent execution failed",
        details: error instanceof Error ? [error.message] : undefined,
      },
      { status: 502 },
    )
  }
}
