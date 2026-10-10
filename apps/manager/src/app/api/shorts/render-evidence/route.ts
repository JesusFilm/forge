import { NextResponse } from "next/server"
import {
  studioInspectionRequestSchema,
  studioInspectionContextSchema,
} from "@forge/studio-contracts/inspection"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
/** Exact historical document and output identity. Sample image payloads stay lazy. */
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = studioInspectionRequestSchema.parse(
      JSON.parse(new TextDecoder().decode(await readStudioBody(request, 2048))),
    )
    const context = studioInspectionContextSchema.parse(
      await createStudioInteractiveClient(actor, request.signal)(
        "inspection-context",
        input,
      ),
    )
    return Response.json(
      { result: { ...context, evidence: null } },
      { headers: { "cache-control": "private, no-store" } },
    )
  } catch (error) {
    return Response.json(
      { error: "Exact render evidence unavailable" },
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
