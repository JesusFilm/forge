import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"
import { startExactHybridShadowEvaluation } from "@/services/recommendations/shadow-evaluation/operator"

const CSRF_HEADER_VALUE = "recommendation-shadow-evaluation-v1"

const StartExactHybridShadowInput = z
  .object({
    action: z.literal("start_exact_hybrid_shadow"),
    evaluationId: z.string().uuid(),
    windowStart: z.string().datetime({ offset: true }),
    windowEnd: z.string().datetime({ offset: true }),
    requestedSampleSize: z.number().int().min(1).max(10_000),
    minimumRuns: z.number().int().min(1).max(10_000),
  })
  .strict()

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOriginCsrfProof(request)) return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments")) {
    return error(403, "permission_denied")
  }
  const actorId = session.principal.id
  if (!actorId) return error(403, "permission_denied")

  let input: z.infer<typeof StartExactHybridShadowInput>
  try {
    input = StartExactHybridShadowInput.parse(await request.json())
  } catch {
    return error(400, "invalid_input")
  }

  try {
    const result = await startExactHybridShadowEvaluation(prisma, {
      evaluationId: input.evaluationId,
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      requestedSampleSize: input.requestedSampleSize,
      minimumRuns: input.minimumRuns,
      actorId,
    })
    return Response.json({ ok: true, ...result }, { status: 202 })
  } catch (cause) {
    if (cause instanceof RecommendationConflictError) {
      return error(409, "evaluation_conflict")
    }
    if (cause instanceof RecommendationInputError) {
      return error(400, "invalid_input")
    }
    return error(500, "evaluation_start_failed")
  }
}

function hasSameOriginCsrfProof(request: Request) {
  const origin = request.headers.get("origin")
  return (
    origin === new URL(request.url).origin &&
    request.headers.get("x-forge-csrf") === CSRF_HEADER_VALUE &&
    request.headers.get("content-type")?.split(";", 1)[0] === "application/json"
  )
}

function error(status: number, code: string) {
  return Response.json({ ok: false, error: code }, { status })
}
