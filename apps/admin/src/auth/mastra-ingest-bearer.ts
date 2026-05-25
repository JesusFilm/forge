// Narrow bearer-key authentication for Mastra -> Admin transcript embedding
// ingest. This intentionally does NOT reuse WORKFLOW_API_KEYS: launching a
// workflow and writing vector payloads are different capabilities.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.MASTRA_TRANSCRIPT_INGEST_API_KEYS) return []
  return env.MASTRA_TRANSCRIPT_INGEST_API_KEYS.split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function isValidMastraTranscriptIngestBearer(
  authHeader: string | null,
): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.trim().length === 0) return false

  const allowlist = parseAllowlist()
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
