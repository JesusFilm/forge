import { NextResponse } from "next/server"
import { env } from "@/config/env"
import {
  assertBearerCsvsDisjoint,
  validateEnrichmentCallbackBearer,
} from "@/lib/admin-trigger-auth"
import { readBoundedJsonBody } from "@/lib/enrichment-execution-body"
import { ExecutionRequestSchema } from "@/lib/enrichment-execution-contract"
import { executeEnrichmentOperation } from "@/lib/enrichment-execution"

export async function POST(request: Request) {
  const auth = validateEnrichmentCallbackBearer(request)
  if (!auth.ok)
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  if (
    !assertBearerCsvsDisjoint(
      env.ADMIN_TRIGGER_API_KEYS,
      env.ENRICHMENT_CALLBACK_API_KEYS,
    )
  )
    return NextResponse.json(
      { error: "config_invalid: service lanes must be disjoint" },
      { status: 503 },
    )
  const body = await readBoundedJsonBody(request)
  if (!body.ok)
    return NextResponse.json({ error: body.error }, { status: body.status })
  const input = ExecutionRequestSchema.safeParse(body.body)
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid execution request" },
      { status: 400 },
    )
  const outcome = await executeEnrichmentOperation(input.data)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
