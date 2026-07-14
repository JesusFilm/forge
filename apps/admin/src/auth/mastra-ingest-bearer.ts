// Narrow bearer-key authentication for Mastra -> Admin embedding ingest. This
// intentionally does NOT reuse WORKFLOW_API_KEYS: launching a workflow and
// writing vector payloads are different capabilities.

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

function isValidMastraIngestBearer(
  authHeader: string | null,
  csv: string | undefined,
): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.trim().length === 0) return false

  const allowlist = parseAllowlist(csv)
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

export function isValidMastraTranscriptIngestBearer(
  authHeader: string | null,
): boolean {
  return isValidMastraIngestBearer(
    authHeader,
    env.MASTRA_TRANSCRIPT_INGEST_API_KEYS,
  )
}

export function isValidMastraExperienceIngestBearer(
  authHeader: string | null,
): boolean {
  return isValidMastraIngestBearer(
    authHeader,
    env.MASTRA_EXPERIENCE_INGEST_API_KEYS,
  )
}
