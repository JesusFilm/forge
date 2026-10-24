// POST /api/backfill/start — Retired legacy scene-vector backfill.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(
    {
      error: "Legacy Manager scene embedding backfill has been retired",
      reason: "legacy_scene_embedding_pipeline_removed",
      replacement:
        "No replacement. Search uses transcript embeddings; historical scene data is retained for feat-199.",
    },
    { status: 410 },
  )
}
