import { z } from "zod"
import { isTrustedReturnToOrigin } from "@/auth/origins"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import { CowatchRefreshBudgetSchema } from "@/services/recommendations/cowatch/refresh-policy"
import { RecommendationCowatchRefreshService } from "@/services/recommendations/cowatch/refresh.service"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"
import { readRecommendationOperatorBody } from "../operator-body"

const MutationInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("authorize"),
      operationId: z.string().uuid(),
      expectedPointerGeneration: z.number().int().positive(),
      budget: CowatchRefreshBudgetSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("disable"),
      grantId: z.string().uuid(),
    })
    .strict(),
])

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } })
const error = (status: number, code: string) =>
  json({ ok: false, error: code }, status)

export async function GET(request: Request): Promise<Response> {
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments"))
    return error(403, "permission_denied")
  const operationId = new URL(request.url).searchParams.get("operationId")
  if (operationId && !z.string().uuid().safeParse(operationId).success)
    return error(400, "invalid_operation")
  try {
    const service = new RecommendationCowatchRefreshService({ prisma })
    const refresh = await service.inspect(
      operationId ? { operationId } : undefined,
    )
    return json({ ok: true, refresh })
  } catch {
    return error(503, "status_unavailable")
  }
}

export async function POST(request: Request): Promise<Response> {
  if (
    !isTrustedReturnToOrigin(request.headers.get("origin")) ||
    request.headers.get("x-forge-csrf") !==
      "recommendation-cowatch-refresh-v1" ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments"))
    return error(403, "permission_denied")
  const body = await readRecommendationOperatorBody(request)
  if (!body.ok) return error(body.status, body.error)
  const parsed = MutationInput.safeParse(body.value)
  if (!parsed.success) return error(400, "invalid_input")
  const input = parsed.data
  if (input.action === "authorize") {
    if (
      session.principal.role === "SYSTEM" ||
      session.principal.studioAuthority === "delegated" ||
      !hasPermission(session.principal, "approve:recommendation-permanent")
    )
      return error(403, "permission_denied")
    const age = session.authenticatedAt
      ? Date.now() - session.authenticatedAt.getTime()
      : Number.POSITIVE_INFINITY
    if (age < -60_000 || age > 15 * 60_000)
      return error(401, "recent_authentication_required")
  }
  try {
    const service = new RecommendationCowatchRefreshService({ prisma })
    const refresh =
      input.action === "authorize"
        ? await service.authorize({
            actor: session.principal,
            authenticatedAt: session.authenticatedAt,
            operationId: input.operationId,
            expectedPointerGeneration: input.expectedPointerGeneration,
            budget: input.budget,
          })
        : await service.disable({
            actor: session.principal,
            grantId: input.grantId,
          })
    return json({ ok: true, refresh })
  } catch (cause) {
    if (cause instanceof ForbiddenError) return error(403, "permission_denied")
    if (cause instanceof RecommendationConflictError)
      return error(409, "refresh_refused")
    if (cause instanceof RecommendationInputError)
      return error(400, "invalid_input")
    return error(503, "acknowledgement_unknown_reconcile_status")
  }
}
