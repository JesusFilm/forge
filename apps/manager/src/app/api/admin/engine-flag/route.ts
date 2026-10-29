import { NextResponse } from "next/server"
import { z } from "zod"

import { authenticateServiceBearerRequest } from "@/lib/auth"
import {
  getRuntimeEnrichmentEngineOverride,
  isMastraEnrichmentRampEnabled,
  resolveEnrichmentEngine,
  setRuntimeEnrichmentEngineOverride,
} from "@/lib/enrichment-engine"

const updateSchema = z
  .object({
    engine: z.enum(["workflow", "mastra"]).optional(),
    clearOverride: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.clearOverride || body.engine, {
    message: "engine or clearOverride is required",
  })

export async function GET(request: Request) {
  const authError = authenticateServiceBearerRequest(request)
  if (authError) return authError

  const engine = await resolveEnrichmentEngine()
  return NextResponse.json({
    engine,
    override: getRuntimeEnrichmentEngineOverride() ?? null,
  })
}

export async function PUT(request: Request) {
  const authError = authenticateServiceBearerRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  if (parsed.data.clearOverride) {
    setRuntimeEnrichmentEngineOverride(undefined)
  } else {
    if (parsed.data.engine === "mastra" && !isMastraEnrichmentRampEnabled()) {
      return NextResponse.json(
        {
          error:
            "Mastra enrichment ramp is disabled until the Mastra workflow emits Manager callbacks.",
          code: "mastra_ramp_disabled",
        },
        { status: 409 },
      )
    }

    setRuntimeEnrichmentEngineOverride(parsed.data.engine)
  }

  const engine = await resolveEnrichmentEngine()
  return NextResponse.json({
    engine,
    override: getRuntimeEnrichmentEngineOverride() ?? null,
  })
}
