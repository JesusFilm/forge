// GET /api/backfill/status — Return current backfill status.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { getBackfillStatus } from "@/services/backfill"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  return NextResponse.json(getBackfillStatus())
}
