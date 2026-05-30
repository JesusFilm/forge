// POST /api/backfill/cancel — Retired legacy scene-vector backfill cancel.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(
    {
      error: "Legacy Manager scene embedding backfill has been retired",
      reason: "scene_embeddings_migrated_to_mastra",
    },
    { status: 410 },
  )
}
