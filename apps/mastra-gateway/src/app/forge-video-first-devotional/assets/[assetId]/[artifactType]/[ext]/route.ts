import { env } from "@/config/env"
import { revalidateDevotionalSession } from "@/lib/devotional-access"
import { proxyMastraRequest } from "@/lib/mastra-proxy"

type RouteContext = {
  params: Promise<{
    assetId: string
    artifactType: string
    ext: string
  }>
}

export async function GET(request: Request, context: RouteContext) {
  const { assetId, artifactType, ext } = await context.params
  const parts = [assetId, artifactType, ext].map(encodeURIComponent)
  return proxyMastraRequest(
    request,
    `/forge-video-first-devotional/assets/${parts.join("/")}`,
    {
      authorizationKey: env.MASTRA_DEVOTIONAL_PLAYBACK_API_KEY,
      allowedRoles: ["admin", "editor"],
      revalidateSession: (session) =>
        revalidateDevotionalSession(session, { recordAccess: false }),
    },
  )
}
