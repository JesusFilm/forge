import { NextResponse } from "next/server"
import { authenticateManagerActorRequest } from "@/lib/auth"
import {
  SharedAgentAccessDeniedError,
  SharedAgentSessionNotFoundError,
  getSharedAgentSessionRuntime,
} from "@/features/agents/shared-agent-runtime"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerActorRequest(request)
  if (actor instanceof NextResponse) return actor

  const { id } = await context.params

  try {
    const session = getSharedAgentSessionRuntime({
      sessionId: id,
      actor,
    })
    return NextResponse.json({ session })
  } catch (error) {
    if (error instanceof SharedAgentSessionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof SharedAgentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }

    console.error("[api/agents/sessions/:id] Session fetch failed:", error)
    return NextResponse.json(
      { error: "Shared agent session fetch failed" },
      { status: 502 },
    )
  }
}
