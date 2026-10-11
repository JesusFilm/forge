import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { loadPrivatePrecomputedCtrReport } from "@/services/recommendations/precomputed/ctr-report"

const Query = z
  .object({
    experimentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/),
    revision: z.coerce.number().int().min(1).max(33).optional(),
  })
  .strict()

/** Read-only, version-addressable contract for an authenticated Admin or AI. */
export async function GET(request: Request): Promise<Response> {
  try {
    const session = await resolveAdminSessionFromRequest(request)
    if (!session) return error(401, "authentication_required")
    if (!hasPermission(session.principal, "read:recommendation-aggregates"))
      return error(403, "permission_denied")
    const url = new URL(request.url)
    if (url.search.length > 512) return error(400, "invalid_input")
    const keys = [...url.searchParams.keys()]
    if (keys.length !== new Set(keys).size) return error(400, "invalid_input")
    const input = Query.parse(Object.fromEntries(url.searchParams))
    const result = await loadPrivatePrecomputedCtrReport(prisma, {
      experimentId: input.experimentId,
      revision: input.revision,
      reviewer: session.principal,
    })
    return Response.json(result, { headers: { "cache-control": "no-store" } })
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(400, "invalid_input")
    return error(500, "ctr_report_read_failed")
  }
}

function error(status: number, code: string) {
  return Response.json(
    { status: "unavailable", reason: code },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  )
}
