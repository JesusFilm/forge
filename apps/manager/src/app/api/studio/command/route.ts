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

export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const raw = new TextDecoder().decode(await readStudioBody(request, 524288))
    const { action, input } = studioRpcSchema.parse(JSON.parse(raw))
    const result = await createStudioInteractiveClient(actor)(action, input)
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
            : "Invalid Studio request",
      },
      { status: error instanceof StudioTransportError ? error.status : 400 },
    )
  }
}
