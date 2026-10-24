import { prisma } from "@/db/client"
import { createStudioPublicPlayback } from "@/services/studio-authoring/public-playback"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
let gateway: ReturnType<typeof createStudioPublicPlayback> | undefined
async function serve(
  request: Request,
  { params }: { params: Promise<{ releaseId: string; resource: string }> },
) {
  gateway ??= createStudioPublicPlayback(prisma)
  if (!gateway)
    return new Response(
      request.method === "HEAD" ? null : "Playback unavailable",
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store",
          "access-control-allow-origin": "*",
        },
      },
    )
  const { releaseId, resource } = await params
  return gateway.serve(releaseId, resource, request)
}
export const GET = serve
export const HEAD = serve
