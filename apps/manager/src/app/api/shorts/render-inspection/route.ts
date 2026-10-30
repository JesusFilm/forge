import { NextResponse } from "next/server"
import { studioInspectionRequestSchema } from "@forge/studio-contracts/inspection"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { inspectStudioRender } from "@/services/studio-inspection"
/** Explicit human inspection; never called by ordinary editor initialization. */
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = studioInspectionRequestSchema.parse(
      JSON.parse(new TextDecoder().decode(await readStudioBody(request, 2048))),
    )
    const result = await inspectStudioRender(
      (action, input, signal) =>
        createStudioInteractiveClient(actor, signal)(action, input),
      input,
      request.signal,
    )
    return Response.json(
      { result },
      { headers: { "cache-control": "private, no-store" } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          "Inspection unavailable; retry explicitly. No unseen media was inspected.",
      },
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
