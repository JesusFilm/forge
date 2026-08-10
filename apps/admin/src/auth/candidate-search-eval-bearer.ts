// Dedicated fixed-semantics credential for current-versus-candidate search.
// Sampling, public-search, workflow, and operator keys must not gain this power.

import { timingSafeEqual } from "node:crypto"

import { parsePartnerToken } from "@/auth/partner-token"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"

const BEARER_PREFIX = /^Bearer\s+/i

function configuredKeys(): readonly string[] {
  return (process.env.CANDIDATE_SEARCH_EVAL_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
}

export function isValidCandidateSearchEvalBearer(
  authHeader: string | null,
): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  if (isValidSearchTraceSamplingBearer(authHeader)) return false
  if (parsePartnerToken(authHeader) != null) return false

  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (!presented.trim()) return false
  const presentedBuffer = Buffer.from(presented)

  let matched = false
  for (const key of configuredKeys()) {
    const keyBuffer = Buffer.from(key)
    if (keyBuffer.length !== presentedBuffer.length) continue
    if (timingSafeEqual(presentedBuffer, keyBuffer)) matched = true
  }
  return matched
}
