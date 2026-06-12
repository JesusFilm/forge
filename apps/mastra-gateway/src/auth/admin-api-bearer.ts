import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function isValidGatewayAdminBearer(authHeader: string | null): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false

  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.trim().length === 0) return false

  const allowlist = parseAllowlist(env.MASTRA_GATEWAY_ADMIN_API_KEYS)
  if (allowlist.length === 0) return false

  const presentedBuffer = Buffer.from(presented)
  let matched = false

  for (const key of allowlist) {
    const keyBuffer = Buffer.from(key)
    if (keyBuffer.length !== presentedBuffer.length) continue
    if (timingSafeEqual(presentedBuffer, keyBuffer)) {
      matched = true
    }
  }

  return matched
}
