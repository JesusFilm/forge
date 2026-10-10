// POST /api/admin-embeds/scene — retired legacy scene-vector backfill proxy.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

export async function POST(request: Request): Promise<Response> {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(
    {
      error: "Legacy scene embedding backfill has been retired",
      reason: "legacy_scene_embedding_pipeline_removed",
      retryable: false,
      replacement:
        "Search uses transcript embeddings; historical scene data is retained for feat-199.",
    },
    { status: 410 },
  )
}
