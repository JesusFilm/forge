import { env } from "@/config/env"
import { revalidateDevotionalSession } from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"

type RouteContext = { params: Promise<{ runId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { runId } = await context.params
  return proxyMastraRequest(
    request,
    `/forge-video-first-devotional/${encodeURIComponent(runId)}`,
    {
      authorizationKey: env.MASTRA_DEVOTIONAL_PLAYBACK_API_KEY,
      allowedRoles: ["admin", "editor"],
      revalidateSession: (session) =>
        revalidateDevotionalSession(session, { recordAccess: false }),
    },
  )
}
