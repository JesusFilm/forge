import { createHash } from "node:crypto"
import { SignJWT, importPKCS8 } from "jose"
import {
  studioRpcSchema,
  STUDIO_INTERACTIVE_AUDIENCE,
  STUDIO_INTERACTIVE_HEADER,
  type StudioAction,
} from "@forge/studio-contracts/transport"
import { env } from "@/config/env"
import type { ManagerInteractiveActor } from "@/lib/auth"

export class StudioTransportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
  }
}
/** Server-only: accepts the actor returned by authenticated Manager session validation. */
export function createStudioInteractiveClient(actor: ManagerInteractiveActor) {
  return async function call(
    action: StudioAction,
    input: unknown,
  ): Promise<unknown> {
    if (
      !env.ADMIN_GRAPHQL_URL ||
      !env.STUDIO_INTERACTIVE_PRIVATE_KEY ||
      !env.STUDIO_INTERACTIVE_KEY_ID
    )
      throw new StudioTransportError(503, "Studio authoring is not configured")
    const body = JSON.stringify(studioRpcSchema.parse({ action, input }))
    const key = await importPKCS8(
      env.STUDIO_INTERACTIVE_PRIVATE_KEY.replaceAll("\\n", "\n"),
      "EdDSA",
    )
    const assertion = await new SignJWT({
      environment: env.STUDIO_ENVIRONMENT,
      digest: createHash("sha256").update(body).digest("hex"),
    })
      .setProtectedHeader({
        alg: "EdDSA",
        typ: "studio-interactive+jwt",
        kid: env.STUDIO_INTERACTIVE_KEY_ID,
      })
      .setIssuer("forge-manager")
      .setAudience(STUDIO_INTERACTIVE_AUDIENCE)
      .setSubject(actor.approvedByUserId)
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(key)
    const response = await fetch(
      new URL("/api/studio/interactive", env.ADMIN_GRAPHQL_URL),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [STUDIO_INTERACTIVE_HEADER]: assertion,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(action === "capture" ? 45000 : 15000),
        cache: "no-store",
      },
    )
    const payload = (await response.json()) as {
      result?: unknown
      error?: string
    }
    if (!response.ok)
      throw new StudioTransportError(
        response.status,
        payload.error ?? "Studio request failed",
      )
    return payload.result
  }
}
export type StudioInteractiveClient = ReturnType<
  typeof createStudioInteractiveClient
>
