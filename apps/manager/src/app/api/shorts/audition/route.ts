import { StudioProductionError } from "@/services/studio-production/errors"
import { NextResponse } from "next/server"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { authenticateStudioRequest, readStudioBody } from "@/lib/studio-request"
import { createStudioInteractiveClient } from "@/backend/studio-interactive"
import { createStudioAssetBroker } from "@/services/studio-broker"

/** Explicit audition reads retained audio only; this route never calls a provider. */
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const ref = studioAssetReferenceSchema.parse(
      JSON.parse(new TextDecoder().decode(await readStudioBody(request, 2048))),
    )
    const call = createStudioInteractiveClient(actor)
    const asset = studioAssetVersionSchema.parse(await call("asset", ref))
    if (
      !["voice", "music", "narration"].includes(asset.role) ||
      !asset.mimeType.startsWith("audio/")
    )
      throw new StudioProductionError("Select retained audio to audition")
    const bytes = await createStudioAssetBroker(call, request.signal).read(
      ref,
      24 * 1024 * 1024,
    )
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": asset.mimeType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Audition unavailable",
      },
      { status: 400 },
    )
  }
}
