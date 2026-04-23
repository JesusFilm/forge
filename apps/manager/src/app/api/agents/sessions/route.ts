import { NextResponse } from "next/server"
import { authenticateManagerActorRequest } from "@/lib/auth"
import { sharedAgentSessionCreateRequestSchema } from "@/features/agents/shared-agent-contract"
import {
  SharedAgentNotFoundError,
  createSharedAgentSessionRuntime,
} from "@/features/agents/shared-agent-runtime"

export async function POST(request: Request) {
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

  const parsed = sharedAgentSessionCreateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    )
  }

  try {
    const session = await createSharedAgentSessionRuntime({
      ...parsed.data,
      actor,
    })
    return NextResponse.json({ session })
  } catch (error) {
    if (error instanceof SharedAgentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    console.error("[api/agents/sessions] Session creation failed:", error)
    return NextResponse.json(
      { error: "Shared agent session creation failed" },
      { status: 502 },
    )
  }
}
