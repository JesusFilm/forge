// GET /api/backfill/status — Retired legacy scene-vector backfill status.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(
    {
      running: false,
      retired: true,
      reason: "legacy_scene_embedding_pipeline_removed",
    },
    { status: 410 },
  )
}
