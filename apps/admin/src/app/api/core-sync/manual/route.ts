import { hasPermission } from "@/auth/permissions"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { dispatchCoreSync } from "@/services/core-sync/job"

function forbidden(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403 })
}

export async function POST(request: Request): Promise<Response> {
  const principal = await resolvePrincipalFromRequest(request)
  if (!hasPermission(principal, "system:trigger-workflow")) {
    return forbidden()
  }

  const dispatch = await dispatchCoreSync({
    incremental: true,
    trigger: "manual",
  })

  return Response.json({ ok: true, dispatch }, { status: 202 })
}
