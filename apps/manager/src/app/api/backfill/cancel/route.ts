// POST /api/backfill/cancel — Request cancellation of the running backfill.

import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { cancelBackfill, getBackfillStatus } from "@/services/backfill"

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const cancelled = cancelBackfill()
  if (!cancelled) {
    return NextResponse.json(
      { error: "No backfill is currently running" },
      { status: 409 },
    )
  }

  return NextResponse.json({
    message: "Backfill cancellation requested",
    status: getBackfillStatus(),
  })
}
