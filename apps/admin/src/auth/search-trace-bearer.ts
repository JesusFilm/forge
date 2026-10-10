// Narrow bearer-key authentication for internal search trace sampling.
// This intentionally does NOT reuse public search, workflow, backup,
// or Mastra ingest credentials.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import { parsePartnerToken } from "@/auth/partner-token"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function isValidSearchTraceSamplingBearer(
  authHeader: string | null,
): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.trim().length === 0) return false

  const allowlist = parseAllowlist(env.SEARCH_TRACE_SAMPLING_API_KEYS)
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
  if (!matched) return false

  // DB-backed public search partner tokens use the jfp_search_* shape. Reject
  // that entire shape even if an operator accidentally pasted one into the
  // sampling CSV; public-search credentials must never gain raw trace export.
  return parsePartnerToken(authHeader) == null
}
