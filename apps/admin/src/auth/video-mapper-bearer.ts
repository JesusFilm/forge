import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.VIDEO_MAPPER_ADMIN_API_KEYS) return []
  return env.VIDEO_MAPPER_ADMIN_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Returns true when the bearer token matches a mapper-specific Admin
 * receiver key. Kept separate from WORKFLOW_API_KEYS so existing workflow and
 * manager callers do not inherit whole-catalog media URL access.
 */
export function isValidVideoMapperBearer(authHeader: string | null): boolean {
  if (!authHeader) return false
  if (!BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.length === 0) return false

  const keys = parseAllowlist()
  if (keys.length === 0) return false

  let matched = false
  const presentedBuf = Buffer.from(presented)
  for (const key of keys) {
    const keyBuf = Buffer.from(key)
    if (keyBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, keyBuf)) {
      matched = true
    }
  }
  return matched
}
