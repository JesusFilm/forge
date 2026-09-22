/**
 * The registration mutation: one deadline-bounded round trip and a typed
 * failure the controller branches on.
 *
 * The transport and the code mapping are the recommendation client's, on
 * purpose. Admin answers the same GraphQL codes on both surfaces, and its
 * per-install limiter answers HTTP 200 with `extensions.http.statusCode: 429`
 * on both — a second copy of that reading would be a second thing to keep in
 * step. What push adds is `extensions.pushCode`, admin's finer reason, which
 * tells a retired token apart from a malformed payload.
 */

import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { type AdminVariablesOf } from "@forge/admin-graphql"

import {
  toRecommendationClientError,
  type RecommendationFailureCode,
} from "../recommendations/errors"
import { mutateWithDeadline } from "../recommendations/transport"
import { PUSH_REGISTRATION_DEADLINE_MS } from "./constants"
import { REGISTER_PUSH_DEVICE } from "./operations"
import type { PushRegistrationPayload } from "./payload"
import type { PushRegistrationReceipt } from "./registration"

export class PushClientError extends Error {
  readonly code: RecommendationFailureCode
  /** True when replaying the same request cannot improve the answer. */
  readonly definitive: boolean
  /** Admin's push-specific reason, e.g. `invalid_token_status`. */
  readonly pushCode: string | null
  readonly retryAfterMs: number | null

  constructor(
    code: RecommendationFailureCode,
    options: {
      definitive?: boolean
      pushCode?: string | null
      retryAfterMs?: number | null
      cause?: unknown
    } = {},
  ) {
    // The message names the code alone: a payload echo here would put the push
    // token and the viewer handle into every log line that catches it.
    super(`push_${code.toLowerCase()}`)
    this.name = "PushClientError"
    this.code = code
    this.definitive = options.definitive ?? false
    this.pushCode = options.pushCode ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
    this.cause = options.cause
  }
}

function extensionsOf(error: unknown): Record<string, unknown> | null {
  if (!CombinedGraphQLErrors.is(error)) return null
  const extensions = error.errors[0]?.extensions
  return extensions == null ? null : (extensions as Record<string, unknown>)
}

export function toPushClientError(error: unknown): PushClientError {
  if (error instanceof PushClientError) return error
  const failure = toRecommendationClientError(error)
  const extensions = extensionsOf(failure.cause ?? error)
  const pushCode = extensions?.pushCode
  // KTD7's global ceiling answers TOO_MANY_REQUESTS, which the shared mapping
  // does not know and would read as a generic GraphQL fault. It is the same
  // "come back later" as the per-install limiter, so it takes the same code.
  const limited = extensions?.code === "TOO_MANY_REQUESTS"
  const code = limited ? "RATE_LIMITED" : failure.code
  return new PushClientError(code, {
    definitive: limited ? false : failure.definitive,
    pushCode: typeof pushCode === "string" ? pushCode : null,
    retryAfterMs: failure.retryAfterMs,
    cause: failure,
  })
}

/** Admin's own input shape, so a field it drops fails here rather than at run
 *  time. The payload IS the input: every field maps across by name. */
type RegisterPushDeviceInput = AdminVariablesOf<
  typeof REGISTER_PUSH_DEVICE
>["input"]

export async function registerPushDevice(
  payload: PushRegistrationPayload,
): Promise<PushRegistrationReceipt> {
  try {
    const input: RegisterPushDeviceInput = payload
    const data = await mutateWithDeadline(
      REGISTER_PUSH_DEVICE,
      { input },
      PUSH_REGISTRATION_DEADLINE_MS,
    )
    const receipt = data.registerPushDevice
    if (receipt?.testDeviceId == null || receipt.testDeviceId.length === 0) {
      // Admin declares the field non-null, so an empty one is a contract break;
      // storing it would leave Profile showing a blank row for good.
      throw new PushClientError("GRAPHQL_ERROR", { definitive: true })
    }
    return { testDeviceId: receipt.testDeviceId, status: receipt.status }
  } catch (error) {
    throw toPushClientError(error)
  }
}
