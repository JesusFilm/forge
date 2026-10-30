import { env } from "@/config/env"
import { studioAttemptResultSchema } from "@forge/studio-contracts"
import { StudioRenderPoolAuth } from "@/services/studio-render-pool-auth"
import { StudioRenderPoolGateway } from "@/services/studio-render-pool-gateway"
import { createStudioPoolHandler } from "@/services/studio-render-pool-http"
import { studioRenderClient } from "@/services/studio-render-transport"
import { prepareStudioDraftRenderInput } from "@/services/studio-render-input"
import {
  retainStudioRenderOutput,
  retainStudioRenderOutputPart,
} from "@/services/studio-render-retention"
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
          prepare: (snapshot, signal, assignment) =>
            prepareStudioDraftRenderInput(
              studioRenderClient(signal).assets,
              snapshot.projectId,
              snapshot.document,
              env.STUDIO_PREVIEW_API_KEY ?? "",
              signal,
              {
                read: () =>
                  studioRenderClient(signal).call("preparation", {
                    attemptId: assignment.attemptId,
                    leaseId: assignment.leaseId,
                  }),
                save: (document) =>
                  studioRenderClient(signal).call("prepare", {
                    attemptId: assignment.attemptId,
                    leaseId: assignment.leaseId,
                    document,
                  }),
              },
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
          retainPart: (snapshot, assignment, part, output, signal) =>
            retainStudioRenderOutputPart(
              studioRenderClient(signal).assets,
              snapshot,
              assignment,
              part,
              output,
              signal,
            ),
          retainParts: async (assignment, parts, proof, signal) => {
            return studioAttemptResultSchema.parse(
              await studioRenderClient(signal).call("retain-output", {
                attemptId: assignment.attemptId,
                leaseId: assignment.leaseId,
                parts,
                proof,
              }),
            )
          },
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
