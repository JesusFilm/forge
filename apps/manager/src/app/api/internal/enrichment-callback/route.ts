import { NextResponse } from "next/server"

import { env } from "@/config/env"
import {
  assertBearerCsvsDisjoint,
  validateEnrichmentCallbackBearer,
} from "@/lib/admin-trigger-auth"
import {
  applyEnrichmentCallback,
  EnrichmentCallbackSchema,
} from "@/lib/enrichment-callback"

export async function POST(request: Request) {
  const auth = validateEnrichmentCallbackBearer(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  if (
    !assertBearerCsvsDisjoint(
      env.ADMIN_TRIGGER_API_KEYS,
      env.ENRICHMENT_CALLBACK_API_KEYS,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "config_invalid: ADMIN_TRIGGER_API_KEYS and ENRICHMENT_CALLBACK_API_KEYS must be disjoint",
      },
      { status: 503 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = EnrichmentCallbackSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await applyEnrichmentCallback(parsed.data)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result)
}
