import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER = /^Bearer\s+(\S+)$/i

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
 * same-length buffers is constant-time for the high-entropy, fixed-length
 * service keys used in deployment. Byte-length checks also prevent multibyte
 * input from violating timingSafeEqual's equal-length precondition.
 */
export function isValidWatchSeoServiceKey(authHeader: string | null): boolean {
  const presented = authHeader?.match(BEARER)?.[1]
  if (!presented) return false
  const presentedBuffer = Buffer.from(presented)
  let matched = false
  for (const key of allowlist()) {
    const keyBuffer = Buffer.from(key)
    if (keyBuffer.length !== presentedBuffer.length) continue
    if (timingSafeEqual(presentedBuffer, keyBuffer)) matched = true
  }
  return matched
}
