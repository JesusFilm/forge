// Consumer-app bearer-key authentication for admin's GraphQL surface.
//
// Mirrors `apps/admin/src/auth/workflow-bearer.ts` byte-for-byte except
// for the env var name (`WEB_ADMIN_API_KEYS` vs `WORKFLOW_API_KEYS`)
// and bucket-prefix semantics. Used by apps/web SSR to identify itself
// to admin so admin's rate-limit identifyFn can bucket consumer-app
// traffic as `consumer:<key>` instead of `public:<cf-connecting-ip>`.
// CGNAT and mobile-carrier NAT collapse many real users onto one IP,
// so the anonymous-IP bucket is too coarse for a consumer-app SSR
// fanout.
//
// CRITICAL: the bearer principal `CONSUMER_BEARER` grants NO permissions
// beyond PUBLIC. See `CONSUMER_BEARER_PERMISSIONS` (empty set) and the
// early-return in `hasPermission`. The bearer's sole purpose is the
// rate-limit bucket key — adding any permission here is a CI-failure
// surface, intentionally.
//
// SECURITY: this module MUST NEVER log the raw `Authorization` header
// value or the matched key string. Log scrubbing is unit-tested in
// `consumer-bearer.test.ts`.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.WEB_ADMIN_API_KEYS) return []
  return env.WEB_ADMIN_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Result of validating an `Authorization: Bearer <key>` header against
 * the `WEB_ADMIN_API_KEYS` CSV allowlist.
 *
 * On match, `bucketKey` is the matched allowlist entry (case-sensitive
 * comparison). The rate-limit identifyFn uses it as the bucket
 * identifier so consumer SSR traffic is grouped per-rotating-key rather
 * than per-IP. On no match (or unset env, or missing/wrong prefix),
 * `valid` is `false` and `bucketKey` is `null`.
 */
export type ConsumerBearerResult =
  | { valid: true; bucketKey: string }
  | { valid: false; bucketKey: null }

/**
 * Validates `Authorization: Bearer <key>` against the
 * `WEB_ADMIN_API_KEYS` CSV. Iterates the full allowlist without
 * short-circuiting on first match, so timing does not reveal which
 * slot matched. Length-mismatched candidates are skipped (the real key
 * length is operator-chosen and not the secret), so timing is
 * constant-time only across same-length entries — the practical
 * guarantee for high-entropy fixed-length keys. When the env var is
 * unset or empty, no header value is accepted.
 *
 * Length comparison uses `Buffer.byteLength` so a non-ASCII allowlist
 * entry (UTF-8 byte length ≠ UTF-16 code-unit length) does not pass
 * the guard and then crash inside `timingSafeEqual`'s equal-length
 * precondition — the call would otherwise throw `RangeError` and
 * surface as a 500 from `createContext`.
 *
 * `null` is returned by `request.headers.get(...)` for missing
 * headers; the caller passes that through unchanged.
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
