import { NextResponse } from "next/server"
import { z } from "zod"
import { studioDocumentSchema, studioIdSchema } from "@forge/studio-contracts"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { getCmsGateway } from "@/cms/gateway"
import { getMux } from "@/services/mux"
import { prepareFootagePresentation } from "@/services/studio-footage-presentation"
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const { projectId, document } = z
      .object({ projectId: studioIdSchema, document: studioDocumentSchema })
      .strict()
      .parse(
        JSON.parse(
          new TextDecoder().decode(await readStudioBody(request, 300000)),
        ),
      )
    const result = await prepareFootagePresentation(
      createStudioInteractiveClient(actor, request.signal),
      projectId,
      document,
      (ids) => getCmsGateway().getVideosForEnrichment(ids),
      (id, time) =>
        getMux().jwt.signPlaybackId(id, {
          type: "thumbnail",
          expiration: "2h",
          params: { time: String(time), width: "160" },
        }),
    )
    return Response.json(result, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    return Response.json(
      { error: "Footage details unavailable" },
      {
        status:
          error instanceof StudioRequestTooLarge
            ? 413
            : error instanceof StudioTransportError
              ? error.status
              : 422,
      },
    )
  }
}
