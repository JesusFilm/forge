// POST /api/video-pipelines/run — Acknowledge a "Run Now" request for one or
// more Video Pipelines cells. This is UI/dashboard scaffolding only: it does
// not dispatch real video generation. See
// docs/plans/2026-07-28-002-feat-video-pipelines-report-plan.md (U4).

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"

const runSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
})

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = runSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  return NextResponse.json(
    { created: parsed.data.videoIds.length, failed: 0 },
    { status: 200 },
  )
}
