import { env } from "@/config/env"
import { createStudioRenderDemandHandler } from "@/services/studio-render-demand"
import { studioRenderClient } from "@/services/studio-render-transport"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
let handler: ReturnType<typeof createStudioRenderDemandHandler> | undefined

export async function GET(request: Request) {
  handler ??= createStudioRenderDemandHandler({
    key: env.STUDIO_RENDER_DEMAND_KEY,
    forbiddenKeys: [
      env.STUDIO_RENDER_WORKER_KEY,
      env.STUDIO_RENDER_CAPABILITY_KEY,
      env.MANAGER_API_KEY,
    ],
    poolId: env.STUDIO_RENDER_POOL_ID,
    workerId: env.STUDIO_RENDER_WORKER_ID,
    enabled: () => env.STUDIO_RENDER_POOL_ENABLED === "true",
    pending: (signal) => studioRenderClient(signal).call("pending", null),
  })
  return handler(request)
}
