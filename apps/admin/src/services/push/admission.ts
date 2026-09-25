/**
 * KTD7 — the admission predicate for the two public push write mutations.
 *
 * It is deliberately not `assertWebRecommendationCaller`: that check refuses a
 * fleet bearer that carries no viewer handle, and a phone must be able to
 * register before it has any viewer identity. The handle stays optional here,
 * but a handle that is present and does not verify is a refusal, never a
 * silent fall back to anonymous. That refusal carries its own code
 * (`viewer_handle_rejected`), so the app can re-check its handle and retry.
 *
 * SECURITY: this module never logs the bearer, the handle, or a digest.
 */
import type { PrismaClient } from "@prisma/client"

import { fleetKeyIdFromRawKey } from "@/auth/fleet-key-id"
import type { Principal } from "@/auth/principal"
import { RecommendationAuthenticationError } from "@/services/recommendations/errors"
import { RecommendationViewerService } from "@/services/recommendations/viewer-identity.service"

import { PushViewerHandleSchema } from "./contracts"
import { PushAdmissionError, PushViewerHandleRejectedError } from "./errors"

export type PushViewerHandleArgs = Readonly<{
  viewerToken?: string | null
  sessionToken?: string | null
}>

export type PushAdmission = Readonly<{
  /** Present only for a fleet bearer; the ceiling counts on it. */
  fleetKeyId: string | null
  viewerDigest: string | null
  sessionDigest: string | null
}>

function admittedCaller(caller: Principal | null): Principal & {
  rateLimitBucketKey: string
} {
  if (
    caller?.role !== "CONSUMER_BEARER" ||
    typeof caller.rateLimitBucketKey !== "string" ||
    caller.rateLimitBucketKey.length === 0
  ) {
    throw new PushAdmissionError()
  }
  return caller as Principal & { rateLimitBucketKey: string }
}

/**
 * Admits one push write. Returns the fleet key id for the ceiling and the
 * viewer identity when the caller proved one.
 */
export async function admitPushWrite(
  prisma: PrismaClient,
  input: { caller: Principal | null; handle: PushViewerHandleArgs },
): Promise<PushAdmission> {
  const caller = admittedCaller(input.caller)
  const fleetKeyId = caller.fleet
    ? fleetKeyIdFromRawKey(caller.rateLimitBucketKey)
    : null

  const { viewerToken, sessionToken } = input.handle
  if (viewerToken == null && sessionToken == null) {
    return { fleetKeyId, viewerDigest: null, sessionDigest: null }
  }

  const handle = PushViewerHandleSchema.safeParse({ viewerToken, sessionToken })
  if (!handle.success) {
    throw new PushAdmissionError("That viewer handle is incomplete")
  }

  try {
    const identity = await new RecommendationViewerService(prisma).resolve(
      caller,
      handle.data.viewerToken,
      handle.data.sessionToken,
    )
    return {
      fleetKeyId,
      viewerDigest: identity.viewer.tokenDigest,
      sessionDigest: identity.sessionDigest,
    }
  } catch (error) {
    // Only a handle Admin refuses is the app's to repair. A database fault
    // stays an internal error, so the app does not re-check a sound handle.
    if (error instanceof RecommendationAuthenticationError) {
      throw new PushViewerHandleRejectedError()
    }
    throw error
  }
}
