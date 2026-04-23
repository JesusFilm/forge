import { getSharedAgentDefinition } from "@forge/agents"
import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  SharedAgentVideoNotFoundError,
  hydrateSharedAgentVideoDraft,
} from "@/features/agents/shared-agent-video-library"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const agentId = url.searchParams.get("agentId")?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 })
  }

  if (!getSharedAgentDefinition(agentId)) {
    return NextResponse.json(
      { error: `Shared agent "${agentId}" was not found.` },
      { status: 404 },
    )
  }

  const { id } = await context.params

  try {
    const hydration = await hydrateSharedAgentVideoDraft({
      agentId,
      videoDocumentId: id,
    })

    return NextResponse.json(hydration)
  } catch (error) {
    if (error instanceof SharedAgentVideoNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    console.error("[api/agents/videos/hydrate] Failed to hydrate video:", error)
    return NextResponse.json(
      { error: "Failed to hydrate library video for agent use" },
      { status: 502 },
    )
  }
}
