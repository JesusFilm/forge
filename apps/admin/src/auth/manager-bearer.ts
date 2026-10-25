import { timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

export function isValidManagerBearer(authHeader: string | null): boolean {
  const expected = env.MANAGER_ADMIN_API_KEY
  if (!authHeader || !expected) {
    return false
  }

  const token = authHeader.replace(BEARER_PREFIX, "")
  if (token === authHeader) {
    return false
  }

  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
