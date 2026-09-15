import { env } from "@/config/env"
import { StudioRenderPoolAuth } from "@/services/studio-render-pool-auth"
import { StudioRenderPoolGateway } from "@/services/studio-render-pool-gateway"
import { createStudioPoolHandler } from "@/services/studio-render-pool-http"
import { studioRenderClient } from "@/services/studio-render-transport"
import { prepareStudioRenderInput } from "@/services/studio-render-input"
import { retainStudioRenderOutput } from "@/services/studio-render-retention"
import { prepareStudioMuxUpload } from "@/services/studio-mux-upload"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
let handler: ReturnType<typeof createStudioPoolHandler> | undefined

/** Dedicated host-worker gateway. Generic Manager keys, interactive cookies and
 * delegated OAuth cannot claim work or manufacture producer asset authority. */
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  if (!handler) {
    try {
      const auth = new StudioRenderPoolAuth({
        poolId: env.STUDIO_RENDER_POOL_ID ?? "",
        workerId: env.STUDIO_RENDER_WORKER_ID ?? "",
        workerKey: env.STUDIO_RENDER_WORKER_KEY ?? "",
        capabilityKey: env.STUDIO_RENDER_CAPABILITY_KEY ?? "",
      })
      handler = createStudioPoolHandler(
        auth,
        new StudioRenderPoolGateway(auth, {
          upload: prepareStudioMuxUpload,
          allowNewClaims: () => env.STUDIO_RENDER_POOL_ENABLED === "true",
          call: (command, input, signal) =>
            studioRenderClient(signal).call(command, input),
          prepare: (snapshot, signal) =>
            prepareStudioRenderInput(
              studioRenderClient(signal).assets,
              snapshot.projectId,
              snapshot.document,
              env.STUDIO_PREVIEW_API_KEY ?? "",
              signal,
            ),
          retain: (snapshot, assignment, output, proof, signal) =>
            retainStudioRenderOutput(
              studioRenderClient(signal).assets,
              snapshot,
              assignment.attemptId,
              assignment.leaseId,
              output,
              proof,
              signal,
            ),
        }),
      )
    } catch {
      return Response.json(
        { error: "Unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      )
    }
  }
  return handler(request, (await context.params).action)
}
