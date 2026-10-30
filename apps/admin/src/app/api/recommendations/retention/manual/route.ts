import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { dispatchManualRecommendationRetention } from "@/services/recommendations/retention/job"

const CSRF_HEADER_VALUE = "recommendation-retention-manual-v1"
const ManualRequest = z.object({ operationId: z.string().uuid() }).strict()

export async function POST(request: Request): Promise<Response> {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("x-forge-csrf") !== CSRF_HEADER_VALUE ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    return Response.json({ ok: false, error: "csrf_failed" }, { status: 403 })
  }

  const session = await resolveAdminSessionFromRequest(request)
  if (!session) {
    return Response.json(
      { ok: false, error: "authentication_required" },
      { status: 401 },
    )
  }
  if (
    !hasPermission(session.principal, "system:trigger-workflow") ||
    !session.principal.id
  ) {
    return Response.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    )
  }

  const input = ManualRequest.safeParse(await request.json().catch(() => null))
  if (!input.success) {
    return Response.json({ ok: false, error: "invalid_input" }, { status: 400 })
  }

  try {
    const dispatch = await dispatchManualRecommendationRetention(
      session.principal.id,
      input.data.operationId,
    )
    if (dispatch.state === "uncertain") {
      return Response.json(
        { ok: false, error: "dispatch_outcome_uncertain", dispatch },
        { status: 409 },
      )
    }
    return Response.json({ ok: true, dispatch }, { status: 202 })
  } catch {
    return Response.json(
      { ok: false, error: "retention_dispatch_failed" },
      { status: 500 },
    )
  }
}
