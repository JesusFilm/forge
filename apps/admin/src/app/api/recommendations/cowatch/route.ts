import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  boundedRecommendationIdentifier,
  recommendationTraceActorDigest,
} from "@/services/recommendations/admin-ops/shared"
import { loadCowatchInspection } from "@/services/recommendations/cowatch/inspection.service"

const Query = z
  .object({
    generationId: z.string().regex(/^[a-f0-9]{64}$/),
    anchor: z.string().regex(boundedRecommendationIdentifier).optional(),
    request: z.string().regex(boundedRecommendationIdentifier).optional(),
  })
  .strict()

/** Exact-generation inspection only; this grants no trial or promotion authority. */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await resolveAdminSessionFromRequest(request)
    if (!session) return error(401, "authentication_required")
    const principal = session.principal
    if (!hasPermission(principal, "read:recommendation-aggregates"))
      return error(403, "permission_denied")
    const url = new URL(request.url)
    if (url.search.length > 2_048) return error(400, "invalid_input")
    const params = url.searchParams
    // Object.fromEntries alone would silently accept the last duplicate value.
    const keys = [...params.keys()]
    if (new Set(keys).size !== keys.length) return error(400, "invalid_input")
    const input = Query.parse(Object.fromEntries(params))
    if (
      input.request &&
      (!principal.id || !hasPermission(principal, "read:recommendation-traces"))
    )
      return error(403, "permission_denied")
    const result = await loadCowatchInspection(prisma, {
      now: new Date(),
      generationId: input.generationId,
      sourceMediaId: input.anchor,
      requestId: input.request,
      // The same service transaction as the dashboard audits any request read.
      actorDigest:
        input.request && principal.id
          ? recommendationTraceActorDigest(
              principal.id,
              env.ADMIN_SESSION_SECRET,
            )
          : null,
    })
    return Response.json(
      { ok: true, result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(400, "invalid_input")
    return error(500, "cowatch_inspection_failed")
  }
}

function error(status: number, code: string) {
  return Response.json(
    { ok: false, error: code },
    { status, headers: { "cache-control": "no-store" } },
  )
}
