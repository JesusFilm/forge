// POST /api/backfill/start — Start the Phase 1 scene vectorization backfill.
// Runs in background via after(). Returns 202 immediately.

import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import {
  claimBackfill,
  startBackfill,
  type BackfillConfig,
} from "@/services/backfill"

const configSchema = z.object({
  batchSize: z.number().int().min(1).max(1000).optional(),
  costThresholdUsd: z.number().min(0).optional(),
  dryRun: z.boolean().optional(),
  rateLimitDelayMs: z.number().int().min(0).optional(),
})

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let config: Partial<BackfillConfig> = {}
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const parsed = configSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    config = parsed.data
  }

  // Claim the lock synchronously before after() to prevent TOCTOU race.
  const claimed = claimBackfill(config)
  if (!claimed) {
    return NextResponse.json(
      { error: "Backfill is already running" },
      { status: 409 },
    )
  }

  after(async () => {
    try {
      await startBackfill()
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "backfill_start_error",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      )
    }
  })

  return NextResponse.json(
    {
      status: "accepted",
      message: config.dryRun ? "Backfill dry-run started" : "Backfill started",
      config,
    },
    { status: 202 },
  )
}
