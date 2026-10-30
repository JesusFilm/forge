import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"

/** Historical inspection URL remains an explicit tombstone after row retirement. */
export async function GET(request: Request): Promise<Response> {
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return response(401, "authentication_required")
  if (!hasPermission(session.principal, "read:recommendation-aggregates"))
    return response(403, "permission_denied")
  return response(410, "behavioral_recommendations_retired")
}

function response(status: number, code: string): Response {
  return Response.json(
    { ok: false, error: code },
    { status, headers: { "cache-control": "no-store" } },
  )
}
