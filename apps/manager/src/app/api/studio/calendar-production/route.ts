import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { calendarProductionSchema } from "@forge/studio-contracts/calendar"
import { authenticateStudioRequest } from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { studioGenerationBatch } from "@/services/studio-agent/generation"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  let admitted = false
  try {
    const input = calendarProductionSchema.parse(
      JSON.parse(await readStudioBytes(request, 8192)),
    )
    const production = await createStudioInteractiveClient(actor)(
      "calendar-production",
      input,
    )
    admitted = true
    return await studioGenerationBatch(
      {
        sub: actor.approvedByUserId,
        authority: "interactive",
        clientId: "studio-manager",
        scopes: ["studio:read", "studio:edit", "studio:chat"],
      },
      production,
      request.signal,
    )
  } catch (error) {
    const knownRejection =
      !admitted &&
      (error instanceof ZodError ||
        ((error instanceof StudioTransportError ||
          error instanceof StudioBoundaryError) &&
          [400, 403, 404, 409, 413, 422].includes(error.status)))
    return Response.json(
      {
        admission: knownRejection ? "rejected" : "unknown",
        error:
          error instanceof StudioBoundaryError
            ? error.message
            : "Production is unready or the calendar selection changed. Review the linked project.",
      },
      {
        status:
          error instanceof StudioBoundaryError ||
          error instanceof StudioTransportError
            ? error.status
            : error instanceof ZodError
              ? 400
              : 503,
      },
    )
  }
}
