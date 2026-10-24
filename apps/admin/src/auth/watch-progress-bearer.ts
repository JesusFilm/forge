import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.WATCH_PROGRESS_ADMIN_API_KEYS) return []
  return env.WATCH_PROGRESS_ADMIN_API_KEYS.split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function isValidWatchProgressBearer(authHeader: string | null): boolean {
  if (!authHeader) return false
  if (!BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.length === 0) return false

  const presentedBuf = Buffer.from(presented)
  let matched = false
  for (const key of parseAllowlist()) {
    const keyBuf = Buffer.from(key)
    if (keyBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, keyBuf)) {
      matched = true
    }
  }
  return matched
}
