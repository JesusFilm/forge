/**
 * KTD7 — one global ceiling per fleet key, per push write operation.
 *
 * It mirrors `@/auth/fleet-ceiling`: a fixed window keyed on the fleet key id,
 * alert-first until the enforce flag is on, and a read that fails allows the
 * request rather than taking registration down.
 *
 * SECURITY: the bucket and every log line carry the sha256 fleet key id, never
 * the key, the push token, or a digest.
 */
import { incrementFixedWindow } from "@/auth/rate-limit"
import { env } from "@/config/env"

import { PushCeilingExceededError } from "./errors"

export const PUSH_CEILING_WINDOW_MS = 60_000
const NEAR_CEILING_RATIO = 0.8

export type PushCeilingOperation = "register" | "open"

export type PushCeilingDecision = { overCeiling: boolean }

function ceilingFor(operation: PushCeilingOperation): number {
  return operation === "register"
    ? env.PUSH_REGISTRATION_CEILING_PER_MIN
    : env.PUSH_OPEN_CEILING_PER_MIN
}

/** Debits this fleet key's counter for one write and decides whether to shed. */
export async function checkPushCeiling(
  operation: PushCeilingOperation,
  fleetKeyId: string,
): Promise<PushCeilingDecision> {
  const ceiling = ceilingFor(operation)
  // 0 = operator kill switch: disable this ceiling without a redeploy.
  if (ceiling === 0) return { overCeiling: false }

  const enforce = env.PUSH_CEILING_ENFORCE === "true"
  const result = await incrementFixedWindow(
    `push-${operation}:${fleetKeyId}`,
    ceiling,
    PUSH_CEILING_WINDOW_MS,
  )

  // Redis INCR is monotonic, so the crossing count fires once per window. The
  // local fallback is a sliding window and never lands on an exact count.
  if (
    result.source === "redis" &&
    result.count === Math.floor(ceiling * NEAR_CEILING_RATIO)
  ) {
    console.warn(
      `[push] event=ceiling.near op=${operation} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} rl=${result.source}`,
    )
  }

  if (result.source === "local") {
    const overLocal = !result.allowed
    if (overLocal) {
      console.warn(
        `[push] event=ceiling.degraded op=${operation} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} blocked=${enforce && overLocal}`,
      )
    }
    return { overCeiling: enforce && overLocal }
  }

  if (result.count === ceiling + 1) {
    console.error(
      `[push] event=ceiling.exceeded op=${operation} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} rl=redis`,
    )
  }
  return { overCeiling: enforce && !result.allowed }
}

/**
 * The gate both push mutations call. A caller with no fleet key id is web SSR
 * or an internal bearer, which the ceiling does not cover.
 */
export async function assertPushCeiling(
  operation: PushCeilingOperation,
  fleetKeyId: string | null,
): Promise<void> {
  if (!fleetKeyId) return
  let overCeiling = false
  try {
    ;({ overCeiling } = await checkPushCeiling(operation, fleetKeyId))
  } catch (error) {
    // Never let a ceiling fault stop a phone registering: log and allow.
    console.error(
      `[push] event=ceiling.error op=${operation} fleetKeyId=${fleetKeyId} error=${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }
  if (overCeiling) throw new PushCeilingExceededError(operation)
}
