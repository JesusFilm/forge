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
import { libraryImage } from "@/services/studio-library-image"

let active = 0
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  if (active >= 2)
    return new Response(null, { status: 503, headers: { "retry-after": "1" } })
  active++
  try {
    const reference = JSON.parse(
      new TextDecoder().decode(await readStudioBody(request, 2048)),
    )
    const { type, bytes, durationMs } = await libraryImage(
      createStudioInteractiveClient(actor, request.signal),
      reference,
      request.signal,
    )
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...(durationMs ? { "x-studio-duration-ms": String(durationMs) } : {}),
        "content-type": type,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    return new Response(null, {
      status:
        error instanceof StudioRequestTooLarge
          ? 413
          : error instanceof StudioTransportError
            ? error.status
            : 422,
    })
  } finally {
    active--
  }
}
