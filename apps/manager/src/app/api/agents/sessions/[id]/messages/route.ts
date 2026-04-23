import { NextResponse } from "next/server"
import { authenticateManagerActorRequest } from "@/lib/auth"
import { sharedAgentSessionMessageRequestSchema } from "@/features/agents/shared-agent-contract"
import {
  SharedAgentAccessDeniedError,
  SharedAgentSessionNotFoundError,
  SharedAgentValidationError,
  sendSharedAgentSessionMessage,
} from "@/features/agents/shared-agent-runtime"

function readLocale(request: Request): string | undefined {
  return request.headers.get("accept-language")?.split(",")[0]?.trim()
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerActorRequest(request)
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

  const parsed = sharedAgentSessionMessageRequestSchema.safeParse(body)
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
    const session = await sendSharedAgentSessionMessage({
      sessionId: id,
      actor,
      locale: readLocale(request),
      message: parsed.data.message,
      draft: parsed.data.draft,
    })

    return NextResponse.json({ session })
  } catch (error) {
    if (error instanceof SharedAgentSessionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof SharedAgentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    if (error instanceof SharedAgentValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400 },
      )
    }

    console.error("[api/agents/sessions/:id/messages] Run failed:", error)
    return NextResponse.json(
      {
        error: "Shared agent session run failed",
        details: error instanceof Error ? [error.message] : undefined,
      },
      { status: 502 },
    )
  }
}
