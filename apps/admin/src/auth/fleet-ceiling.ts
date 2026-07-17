// Global per-fleet-key abuse ceiling for the public search path (F1 #2): one
// counter per fleet key across all IPs/viewer_ids on BOTH search entry points.
// SECURITY: bucket + logs key on the sha256 fleetKeyId, never the raw key.

import { env } from "@/config/env"
import { incrementFixedWindow } from "@/auth/rate-limit"
import type { BearerCheckResult } from "@/auth/search-bearer"

export const FLEET_GLOBAL_WINDOW_MS = 60_000
const NEAR_CEILING_RATIO = 0.8

export type FleetCeilingDecision = { overCeiling: boolean }

/**
 * Debits the fleet key's global counter for one search request and decides
 * whether to shed it. `overCeiling` is only ever true when
 * `FLEET_SEARCH_CEILING_ENFORCE === "true"` (alert-first rollout).
 */
export async function checkFleetGlobalCeiling(
  fleetKeyId: string,
  path: "graphql" | "rest",
): Promise<FleetCeilingDecision> {
  const ceiling = env.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN
  // 0 = operator kill-switch: disable the ceiling without a redeploy.
  if (ceiling === 0) return { overCeiling: false }

  const enforce = env.FLEET_SEARCH_CEILING_ENFORCE === "true"
  const result = await incrementFixedWindow(
    `fleet-global:${fleetKeyId}`,
    ceiling,
    FLEET_GLOBAL_WINDOW_MS,
  )

  // Redis INCR is monotonic so the exact crossing fires once per window; the
  // local (sliding-window) fallback is not, so scope .near to the redis source.
  if (
    result.source === "redis" &&
    result.count === Math.floor(ceiling * NEAR_CEILING_RATIO)
  ) {
    console.warn(
      `[search] event=fleet_ceiling.near path=${path} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} rl=${result.source}`,
    )
  }

  if (result.source === "local") {
    // Redis degraded → honor the per-replica local cap (already the FULL
    // ceiling). Bounds a single-replica blast at ceiling×replicas, not infinity.
    const overLocal = !result.allowed
    if (overLocal) {
      console.warn(
        `[search] event=fleet_ceiling.degraded path=${path} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} blocked=${enforce && overLocal}`,
      )
    }
    return { overCeiling: enforce && overLocal }
  }

  if (result.count === ceiling + 1) {
    // First-over only (redis INCR grows unbounded past the ceiling).
    console.error(
      `[search] event=fleet_ceiling.exceeded path=${path} fleetKeyId=${fleetKeyId} count=${result.count} ceiling=${ceiling} enforce=${enforce} rl=redis`,
    )
  }
  return { overCeiling: enforce && !result.allowed }
}

/**
 * Shared gate for BOTH search entry points: fleet-source check, missing-id
 * loud-degrade, and a defensive catch so a ceiling bug can never 500 search.
 * Returns true when the request should be shed (429).
 */
export async function shouldShedFleetRequest(
  authResult: BearerCheckResult,
  path: "graphql" | "rest",
): Promise<boolean> {
  if (!authResult.valid || authResult.source !== "fleet") return false
  if (!authResult.fleetKeyId) {
    // A fleet bearer must always carry a fleetKeyId — loud-degrade (log + allow),
    // never a silent skip or a fleet-wide block from a derivation bug.
    console.error(`[search] event=fleet_ceiling.missing_key_id path=${path}`)
    return false
  }
  try {
    const { overCeiling } = await checkFleetGlobalCeiling(
      authResult.fleetKeyId,
      path,
    )
    return overCeiling
  } catch (err) {
    // Never let a ceiling bug take down fleet search — loud-degrade to allow,
    // mirroring the auth composer's defensive try/catch posture.
    console.error(
      `[search] event=fleet_ceiling.error path=${path} fleetKeyId=${authResult.fleetKeyId} error=${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}
