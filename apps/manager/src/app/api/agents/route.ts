import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { listSharedAgentCatalog } from "@/features/agents/shared-agent-runtime"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json({ agents: listSharedAgentCatalog() })
}
