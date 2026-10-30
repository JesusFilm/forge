import { NextResponse } from "next/server"
import { authenticateStudioRequest, readStudioBody } from "@/lib/studio-request"
import { studioGenerationBatch } from "@/services/studio-agent/generation"
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    return await studioGenerationBatch(
      {
        sub: actor.approvedByUserId,
        authority: "interactive",
        clientId: "shorts-manager",
        scopes: ["shorts:read", "shorts:edit", "shorts:chat"],
      },
      JSON.parse(
        new TextDecoder().decode(await readStudioBody(request, 65536)),
      ),
      request.signal,
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Generation admission rejected",
      },
      { status: 400 },
    )
  }
}
