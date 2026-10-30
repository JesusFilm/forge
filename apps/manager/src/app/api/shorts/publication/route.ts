import { NextResponse } from "next/server"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import { prepareInteractiveStudioPublication } from "@/services/studio-publication"

/** Read-only provider preparation. Approval and publication remain separate
 * canonical interactive commands, and no paid asset create occurs here. */
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
  try {
    const input = JSON.parse(
      new TextDecoder().decode(await readStudioBody(request, 2048, signal)),
    )
    signal.throwIfAborted()
    const result = await prepareInteractiveStudioPublication(
      createStudioInteractiveClient(actor, signal),
      input,
      signal,
    )
    signal.throwIfAborted()
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof StudioTransportError
            ? error.code
            : "Publication preparation unavailable",
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
