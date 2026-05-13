// Consumer-app bearer-key auth for admin's GraphQL surface. Lets apps/web
// SSR identify as `consumer:<key>` instead of `public:<cf-connecting-ip>`
// (CGNAT + mobile-carrier NAT make the IP bucket too coarse for SSR fanout).
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

function parseAllowlist(): string[] {
  if (!env.WEB_ADMIN_API_KEYS) return []
  return env.WEB_ADMIN_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

export type ConsumerBearerResult =
  | { valid: true; bucketKey: string }
  | { valid: false; bucketKey: null }

/**
 * SECURITY: iterates the full allowlist without short-circuiting so timing
 * does not reveal which slot matched. `Buffer.byteLength` precheck avoids
 * `timingSafeEqual`'s equal-length `RangeError` on non-ASCII entries.
 */
export function isValidConsumerBearer(
  authHeader: string | null,
): ConsumerBearerResult {
  if (!authHeader) return { valid: false, bucketKey: null }
  if (!BEARER_PREFIX.test(authHeader)) return { valid: false, bucketKey: null }
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.length === 0) return { valid: false, bucketKey: null }

  const keys = parseAllowlist()
  if (keys.length === 0) return { valid: false, bucketKey: null }

  let matchedKey: string | null = null
  const presentedBuf = Buffer.from(presented)
  for (const key of keys) {
    const keyBuf = Buffer.from(key)
    if (keyBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, keyBuf)) {
      matchedKey = key
    }
  }
  if (matchedKey === null) return { valid: false, bucketKey: null }
  return { valid: true, bucketKey: matchedKey }
}
