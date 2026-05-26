// POST /api/backfill/start — Retired legacy scene-vector backfill.
// Scene embedding generation now belongs to Mastra and is launched from Admin.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(
    {
      error: "Legacy Manager scene embedding backfill has been retired",
      reason: "scene_embeddings_migrated_to_mastra",
      replacement:
        "Use Admin scene embedding backfill; Admin launches Mastra and owns storage/search.",
    },
    { status: 410 },
  )
}
