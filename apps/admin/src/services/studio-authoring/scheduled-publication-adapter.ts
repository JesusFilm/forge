import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import {
  studioPublicationFailureSchema,
  studioPublishSchema,
  studioScheduledPublicationPreparationSchema,
  type StudioPublish,
} from "@forge/studio-contracts/publication"
import { readStudioBytes } from "@forge/studio-server"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { StudioCommandError } from "./errors"
import { studioHash } from "./state"
import { StudioCatalogPublicationService } from "./catalog-publication"
import type { StudioSchedulePublicationHook } from "./scheduled-publication"

/** Preparation has no publication side effect, even if its response is lost.
 * This is not the carrier for failures from canonical submission. */
export class StudioPublicationPreparationError extends StudioCommandError {
  readonly submission = "not-submitted" as const
}

/** Admin workflow → trusted Manager observation. Call only when Calendar has
 * no stored submission. Persist the returned envelope before attempting publish. */
export async function prepareScheduledStudioPublication(
  raw: unknown,
  signal?: AbortSignal,
): Promise<StudioPublish> {
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(50000)])
    : AbortSignal.timeout(50000)
  try {
    const input = studioScheduledPublicationPreparationSchema.parse(raw)
    if (!env.MANAGER_API_BASE_URL || !env.MANAGER_TRIGGER_API_KEY)
      throw new StudioPublicationPreparationError("UNREADY")
    const url = new URL(
      "/api/admin-trigger/studio-publication",
      env.MANAGER_API_BASE_URL,
    )
    const local =
      env.STUDIO_ENVIRONMENT === "local" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    if ((url.protocol !== "https:" && !local) || url.username || url.password)
      throw new StudioPublicationPreparationError("UNREADY")
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.MANAGER_TRIGGER_API_KEY}`,
      },
      body: JSON.stringify(input),
      redirect: "error",
      cache: "no-store",
      signal: deadline,
    })
    const body: unknown = JSON.parse(await readStudioBytes(response, 8192))
    if (!response.ok) {
      const parsed = z
        .object({
          error: studioPublicationFailureSchema,
          submission: z.literal("not-submitted"),
        })
        .safeParse(body)
      throw new StudioPublicationPreparationError(
        parsed.success ? parsed.data.error : "UNREADY",
      )
    }
    const { result } = z
      .object({
        result: studioPublishSchema,
        submission: z.literal("not-submitted"),
      })
      .strict()
      .parse(body)
    const { readinessId, ...returned } = result
    if (!readinessId || studioHash(returned) !== studioHash(input))
      throw new StudioPublicationPreparationError("STALE_BINDING")
    deadline.throwIfAborted()
    return result
  } catch (error) {
    if (error instanceof StudioPublicationPreparationError) throw error
    throw new StudioPublicationPreparationError("UNREADY")
  }
}

/** Same mandatory catalog verifier as manual publication. This wrapper never
 * refreshes readiness: stored/ambiguous envelopes go straight to receipt lookup. */
export function publishPreparedStudioProject(
  db: PrismaClient,
  servicePrincipal: Principal,
  exactEnvelope: unknown,
  consume: StudioSchedulePublicationHook,
) {
  const input = studioPublishSchema.parse(exactEnvelope)
  if (!input.schedule || typeof consume !== "function")
    throw new StudioCommandError("AUTHORIZATION_REVOKED")
  return new StudioCatalogPublicationService(db, consume).publish(
    servicePrincipal,
    input,
  )
}
