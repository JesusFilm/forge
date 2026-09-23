import { NextResponse } from "next/server"
import { z } from "zod"
import { studioIdSchema } from "@forge/studio-contracts"
import { studioInspectionContextSchema } from "@forge/studio-contracts/inspection"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { createStudioAssetBroker } from "@/services/studio-broker"

/** Authenticated review of exact retained export bytes before publication.
 * The browser gets a local Blob URL, never the upstream transfer capability. */
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
  try {
    const input = z
      .object({ projectId: studioIdSchema, renderAttemptId: studioIdSchema })
      .strict()
      .parse(
        JSON.parse(
          new TextDecoder().decode(await readStudioBody(request, 2048, signal)),
        ),
      )
    const call = createStudioInteractiveClient(actor, signal)
    const context = studioInspectionContextSchema.parse(
      await call("inspection-context", {
        projectId: input.projectId,
        attemptId: input.renderAttemptId,
      }),
    )
    const bytes = await createStudioAssetBroker(call, signal).read(
      context.output,
      128 * 1024 * 1024,
    )
    signal.throwIfAborted()
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(bytes.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    return Response.json(
      { error: "Render review unavailable" },
      {
        status:
          error instanceof StudioRequestTooLarge
            ? 413
            : error instanceof StudioTransportError
              ? error.status
              : 400,
        headers: { "cache-control": "no-store" },
      },
    )
  }
}
