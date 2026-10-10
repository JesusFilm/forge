import { env } from "@/config/env"
import { revalidateDevotionalSession } from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"

type RouteContext = { params: Promise<{ runId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { runId } = await context.params
  return proxyMastraRequest(
    request,
    `/forge-video-first-devotional/${encodeURIComponent(runId)}/resume`,
    {
      authorizationKey: env.MASTRA_DEVOTIONAL_APPROVAL_API_KEY,
      allowedRoles: ["admin", "editor"],
      revalidateSession: revalidateDevotionalSession,
    },
  )
}
