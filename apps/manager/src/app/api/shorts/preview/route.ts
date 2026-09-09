import { NextResponse } from "next/server"
import { z } from "zod"
import { studioDocumentSchema, studioIdSchema } from "@forge/studio-contracts"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import { createStudioInteractiveClient } from "@/backend/studio-interactive"
import {
  prepareStudioPreview,
  releaseStudioPreview,
  renewStudioPreview,
  StudioBrokerError,
  StudioBrokerBusyError,
} from "@/services/studio-broker"
export const maxDuration = 300
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const raw = new TextDecoder().decode(await readStudioBody(request, 300000))
    const input = z
      .object({ projectId: studioIdSchema, document: studioDocumentSchema })
      .strict()
      .parse(JSON.parse(raw))
    return Response.json(
      await prepareStudioPreview(
        createStudioInteractiveClient(actor),
        input.projectId,
        input.document,
        request.signal,
      ),
      { headers: { "cache-control": "no-store" } },
    )
  } catch (e) {
    if (e instanceof StudioRequestTooLarge)
      return new Response(null, { status: 413 })
    return Response.json(
      {
        error:
          e instanceof StudioBrokerError
            ? e.message
            : "Preview preparation failed",
      },
      { status: e instanceof StudioBrokerBusyError ? 503 : 422 },
    )
  }
}

export async function DELETE(request: Request) {
  return updateSession(request, releaseStudioPreview)
}
export async function PATCH(request: Request) {
  return updateSession(request, renewStudioPreview)
}
async function updateSession(
  request: Request,
  update: (url: string) => Promise<void>,
) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const { url } = z
      .object({ url: z.string().url() })
      .strict()
      .parse(
        JSON.parse(
          new TextDecoder().decode(await readStudioBody(request, 2048)),
        ),
      )
    await update(url)
    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 400 })
  }
}
