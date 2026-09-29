import { z } from "zod"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import { RecommendationConflictError } from "@/services/recommendations/errors"
import {
  prepareCompositionProtocol,
  PrepareComposition,
  decideCompositionProtocol,
  recordCompositionCalibration,
  inspectComposition,
} from "@/services/recommendations/composition/service"

const Input = z.discriminatedUnion("action", [
  PrepareComposition.extend({ action: z.literal("prepare") }),
  z
    .object({ action: z.literal("decide"), protocolId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("calibrate"),
      protocolId: z.string().uuid(),
      evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      configDigest: z.string().regex(/^[a-f0-9]{64}$/),
      rationale: z.string().min(20).max(512),
    })
    .strict(),
])
export async function GET(request: Request) {
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  try {
    const protocolId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("protocolId"))
    return Response.json(
      {
        ok: true,
        result: await inspectComposition(prisma, session.principal, protocolId),
      },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (cause) {
    return handleError(cause)
  }
}
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("x-forge-csrf") !== "recommendation-composition-v1" ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  try {
    const input = Input.parse(await request.json())
    const operator = {
      actor: session.principal,
      authenticatedAt: session.authenticatedAt,
    }
    const { action, ...payload } = input
    const result =
      action === "prepare"
        ? await prepareCompositionProtocol(
            prisma,
            operator,
            Input.options[0].omit({ action: true }).parse(payload),
          )
        : action === "decide"
          ? await decideCompositionProtocol(prisma, operator, input.protocolId)
          : await recordCompositionCalibration(
              prisma,
              operator,
              Input.options[2].omit({ action: true }).parse(payload),
            )
    return Response.json(
      { ok: true, result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (cause) {
    return handleError(cause)
  }
}
function handleError(cause: unknown) {
  if (cause instanceof ForbiddenError)
    return error(403, "permission_or_recent_auth_required")
  if (cause instanceof z.ZodError || cause instanceof SyntaxError)
    return error(400, "invalid_input")
  if (cause instanceof RecommendationConflictError)
    return error(409, cause.message)
  return error(500, "composition_operation_failed")
}
function error(status: number, code: string) {
  return Response.json(
    { ok: false, error: code },
    { status, headers: { "cache-control": "no-store" } },
  )
}
