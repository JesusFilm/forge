import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/config/env"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import {
  createStudioInteractiveClient,
  StudioTransportError,
} from "@/backend/studio-interactive"
import {
  existingVoiceInput,
  importExistingVoice,
  searchExistingVoices,
} from "@/services/studio-production/existing-voices"
import { StudioProductionError } from "@/services/studio-production/errors"
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search"), query: z.string().max(200) }).strict(),
  z.object({ kind: z.literal("import"), input: existingVoiceInput }).strict(),
])
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = inputSchema.parse(
      JSON.parse(new TextDecoder().decode(await readStudioBody(request, 4096))),
    )
    const result =
      input.kind === "search"
        ? await searchExistingVoices(input.query, env.ELEVENLABS_API_KEY ?? "")
        : await importExistingVoice(
            input.input,
            createStudioInteractiveClient(actor),
            env.ELEVENLABS_API_KEY ?? "",
            env.ADMIN_GRAPHQL_URL ?? "",
          )
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof StudioProductionError ||
          error instanceof StudioTransportError
            ? error.message
            : "Could not load this voice preset",
      },
      {
        status:
          error instanceof StudioRequestTooLarge
            ? 413
            : error instanceof StudioTransportError
              ? error.status
              : 400,
      },
    )
  }
}
