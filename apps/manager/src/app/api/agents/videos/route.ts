import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { searchSharedAgentLibraryVideos } from "@/features/agents/shared-agent-video-library"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const query = url.searchParams.get("query") ?? ""

  return NextResponse.json({
    videos: await searchSharedAgentLibraryVideos(query),
  })
}
