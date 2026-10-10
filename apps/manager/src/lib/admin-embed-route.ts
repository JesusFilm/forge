// Shared route-handler shape for the active manager → admin transcript
// embed-trigger REST proxy. The legacy scene proxy is a separate 410
// tombstone and must not call this helper.

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import type { AdminTriggerEnvelope } from "@/lib/admin-embed-trigger"

type ProxyArgs<TVars> = {
  request: Request
  bodySchema: z.ZodType<TVars>
  trigger: (vars: TVars) => Promise<AdminTriggerEnvelope>
}

export async function proxyAdminEmbedTrigger<TVars>({
  request,
  bodySchema,
  trigger,
}: ProxyArgs<TVars>): Promise<Response> {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await trigger(parsed.data)

  if (result.ok) {
    return NextResponse.json({ result: result.data }, { status: 200 })
  }

  // Exhaustive map from `result.reason` to HTTP status. The
  // `_exhaustive: never` assertion at the bottom forces a compile
  // error if a new envelope variant is added without updating the
  // mapping here.
  switch (result.reason) {
    case "config_missing":
      // 503 = service unavailable; admin proxy isn't configured.
      // Operators can fix by setting Doppler env + redeploying;
      // distinguishes from a real 500 (unexpected manager bug).
      return NextResponse.json(
        {
          error: "admin embed proxy not configured",
          reason: result.reason,
          messages: result.messages,
          retryable: result.retryable,
        },
        { status: 503 },
      )
    case "graphql_error":
    case "network_error":
    case "parse_error":
      return NextResponse.json(
        {
          error: "admin trigger failed",
          reason: result.reason,
          messages: result.messages,
          retryable: result.retryable,
        },
        { status: 502 },
      )
    default: {
      const _exhaustive: never = result
      throw new Error(
        `unhandled admin trigger envelope: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}
