// Consumer-app bearer-key auth for admin's GraphQL surface. Lets apps/web
// SSR identify as `consumer:<key>` instead of `public:<cf-connecting-ip>`
// (CGNAT + mobile-carrier NAT make the IP bucket too coarse for SSR fanout).
//
// Two allowlists mint the CONSUMER_BEARER principal: WEB_ADMIN_API_KEYS
// (web SSR, per-key) and FLEET_ADMIN_API_KEYS (tv/mobile, flagged `fleet`
// so the limiter buckets per-IP). Disjoint by the env boot invariant.
//
// CRITICAL: the bearer principal grants NO permissions beyond PUBLIC — its
// sole purpose is the rate-limit bucket key. Adding any permission is a
// deliberate CI-failure surface.
//
// SECURITY: NEVER log the raw `Authorization` header value or matched key.
// Log scrubbing is unit-tested in `consumer-bearer.test.ts`.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseCsv(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

type BearerEntry = { key: string; fleet: boolean }

function bearerEntries(): BearerEntry[] {
  return [
    ...parseCsv(env.WEB_ADMIN_API_KEYS).map((key) => ({ key, fleet: false })),
    ...parseCsv(env.FLEET_ADMIN_API_KEYS).map((key) => ({ key, fleet: true })),
  ]
}

export type ConsumerBearerResult =
  | { valid: true; bucketKey: string; fleet: boolean }
  | { valid: false; bucketKey: null }

/**
 * SECURITY: iterates the full web + fleet allowlist without short-circuiting
 * so timing does not reveal which slot matched. The two CSVs are disjoint (env
 * boot invariant), so at most one entry matches; `fleet` reflects which list
 * it came from and drives per-IP vs per-key bucketing downstream.
 */
export function isValidConsumerBearer(
  authHeader: string | null,
): ConsumerBearerResult {
  if (!authHeader) return { valid: false, bucketKey: null }
  if (!BEARER_PREFIX.test(authHeader)) return { valid: false, bucketKey: null }
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.length === 0) return { valid: false, bucketKey: null }

  const entries = bearerEntries()
  if (entries.length === 0) return { valid: false, bucketKey: null }

  let matched: BearerEntry | null = null
  const presentedBuf = Buffer.from(presented)
  for (const entry of entries) {
    const keyBuf = Buffer.from(entry.key)
    if (keyBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, keyBuf)) {
      matched = entry
    }
  }
  if (matched === null) return { valid: false, bucketKey: null }
  return { valid: true, bucketKey: matched.key, fleet: matched.fleet }
}
