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
import { prepareStudioWaveform } from "@/services/studio-waveform"
export const maxDuration = 60
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const { projectId, document, itemId } = z
      .object({
        projectId: studioIdSchema,
        document: studioDocumentSchema,
        itemId: studioIdSchema,
      })
      .strict()
      .parse(
        JSON.parse(
          new TextDecoder().decode(await readStudioBody(request, 300000)),
        ),
      )
    return Response.json(
      await prepareStudioWaveform(
        createStudioInteractiveClient(actor, request.signal),
        projectId,
        document,
        itemId,
        request.signal,
      ),
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return Response.json(
      { error: "Audio waveform unavailable" },
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
