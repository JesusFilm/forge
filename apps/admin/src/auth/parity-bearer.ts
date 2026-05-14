// Parity-verification bearer-key authentication for admin's GraphQL surface.
//
// Mirrors `consumer-bearer.ts` byte-for-byte except for the env var
// name (`PARITY_API_KEYS` vs `WEB_ADMIN_API_KEYS`). Used ONLY by the
// pre-cutover batch-verification harness in
// `packages/graphql/scripts/run-batch-verification.ts` to enumerate
// template Experiences that R9 hides from CONSUMER_BEARER.
//
// CRITICAL: the bearer principal `PARITY_BEARER` grants exactly ONE
// permission: `read:experience-templates`. See `PARITY_BEARER_PERMISSIONS`
// (single-entry set, CI-asserted) and the early-return in `hasPermission`.
// Widening that set is a CI-failure surface, intentionally.
//
// SECURITY: this module MUST NEVER log the raw `Authorization` header
// value or the matched key string. Log scrubbing is unit-tested in
// `parity-bearer.test.ts`.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.PARITY_API_KEYS) return []
  return env.PARITY_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Result of validating an `Authorization: Bearer <key>` header against
 * the `PARITY_API_KEYS` CSV allowlist.
 */
export type ParityBearerResult =
  | { valid: true; bucketKey: string }
  | { valid: false; bucketKey: null }

/**
 * Validates `Authorization: Bearer <key>` against `PARITY_API_KEYS`.
 * Same timing-safe iteration shape as `isValidConsumerBearer`:
 *  - full allowlist walk (no early return) for constant-time across
 *    same-length entries,
 *  - `Buffer.byteLength` length-mismatch skip so a non-ASCII entry
 *    doesn't trip `timingSafeEqual`'s equal-length precondition,
 *  - unset / empty env or wrong prefix returns `{ valid: false }`.
 */
export function isValidParityBearer(
  authHeader: string | null,
): ParityBearerResult {
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
