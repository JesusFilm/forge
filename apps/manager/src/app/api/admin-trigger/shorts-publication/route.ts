import { studioPublicationFailureSchema } from "@forge/studio-contracts/publication"
import { StudioBoundaryError } from "@forge/studio-server"
import { validateAdminTriggerBearer } from "@/lib/admin-trigger-auth"
import { readStudioBody, StudioRequestTooLarge } from "@/lib/studio-request"
import { prepareScheduledPublication } from "@/services/studio-publication"

/** Readiness-only capability. Never creates an asset, approval or publication.
 * Even a lost preparation response cannot have submitted a publication command. */
export async function POST(request: Request) {
  const auth = validateAdminTriggerBearer(request)
  if (!auth.ok)
    return Response.json(
      { error: "AUTHORIZATION_REVOKED", submission: "not-submitted" },
      { status: auth.status, headers: { "cache-control": "no-store" } },
    )
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
  try {
    const input = JSON.parse(
      new TextDecoder().decode(await readStudioBody(request, 4096, signal)),
    )
    signal.throwIfAborted()
    const result = await prepareScheduledPublication(input, signal)
    signal.throwIfAborted()
    return Response.json(
      { result, submission: "not-submitted" },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    const parsed = studioPublicationFailureSchema.safeParse(
      error instanceof Error ? error.message : null,
    )
    const code = parsed.success
      ? parsed.data
      : error instanceof StudioBoundaryError &&
          [401, 403].includes(error.status)
        ? "AUTHORIZATION_REVOKED"
        : "UNREADY"
    return Response.json(
      { error: code, submission: "not-submitted" },
      {
        status: error instanceof StudioRequestTooLarge ? 413 : 409,
        headers: { "cache-control": "no-store" },
      },
    )
  }
}
