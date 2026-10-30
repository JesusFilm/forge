import { NextResponse } from "next/server"
import { studioRpcSchema } from "@forge/studio-contracts/transport"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { libraryArtwork } from "@/services/studio-library-artwork"
import { getCmsGateway } from "@/cms/gateway"
import { getMux } from "@/services/mux"

export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const raw = new TextDecoder().decode(await readStudioBody(request, 524288))
    const { action, input } = studioRpcSchema.parse(JSON.parse(raw))
    let result = await createStudioInteractiveClient(actor)(action, input)
    if (action === "search" && Array.isArray(result) && result.length) {
      const artwork = await libraryArtwork(
        result,
        (ids) => getCmsGateway().getVideosForEnrichment(ids, true),
        (id) =>
          getMux().jwt.signPlaybackId(id, {
            type: "thumbnail",
            expiration: "2h",
            params: { width: "320", time: "0" },
          }),
      )
      result = result.map((row) => ({
        ...row,
        thumbnailUrl: artwork[row.videoId],
      }))
    }
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof StudioRequestTooLarge)
      return new Response(null, { status: 413 })
    return Response.json(
      {
        publicationRejected:
          error instanceof StudioTransportError && error.publicationRejected,
        error:
          error instanceof StudioTransportError
            ? error.code
            : "Invalid Shorts request",
      },
      { status: error instanceof StudioTransportError ? error.status : 400 },
    )
  }
}
