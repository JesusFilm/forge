import { createHash, timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER = /^Bearer\s+(\S+)$/i

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

/** True when the service-key CSV is configured at all (fail-closed probe). */
export function isWatchSeoServiceKeyConfigured(): boolean {
  return allowlist().length > 0
}

function allowlist(): string[] {
  if (!env.WATCH_SEO_API_KEYS) return []
  return env.WATCH_SEO_API_KEYS.split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

/**
 * Validates the dedicated Watch SEO service key from `Authorization: Bearer`.
 * This key only proves the caller is Web's private adapter; it is disjoint from
 * WEB_ADMIN_API_KEYS and never mints a principal or permission. Comparing
 * fixed-length digests keeps timing independent of key length.
 */
export function isValidWatchSeoServiceKey(authHeader: string | null): boolean {
  const presented = authHeader?.match(BEARER)?.[1]
  if (!presented) return false
  const presentedDigest = digest(presented)
  let matched = false
  for (const key of allowlist()) {
    if (timingSafeEqual(presentedDigest, digest(key))) matched = true
  }
  return matched
}
