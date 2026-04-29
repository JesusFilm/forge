// Service-to-service bearer-key authentication for admin's GraphQL
// trigger surface.
//
// Companion to apps/admin/src/app/api/workflows/[...workflow]/route.ts,
// which uses the same `WORKFLOW_API_KEYS` env var but with HMAC
// signature + timestamp skew (durable-workflow-callback semantics).
// This module is the simpler bearer-token surface used by
// apps/manager → admin's GraphQL trigger mutations: a request that
// carries `Authorization: Bearer <key>` matching one of the keys in
// the comma-separated `WORKFLOW_API_KEYS` allowlist resolves to the
// `WORKFLOW_TRIGGER` principal during context creation.
//
// The two surfaces share an env var on purpose — Doppler rotates one
// key and both paths pick it up. The HMAC-vs-bearer split is about
// the threat model of each callee: durable workflow callbacks need
// replay protection; manager-triggered mutations are operator-driven
// and idempotent (workflows upsert on composite keys).

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.WORKFLOW_API_KEYS) return []
  return env.WORKFLOW_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Returns true if `Authorization: Bearer <key>` matches one of the
 * keys configured in `WORKFLOW_API_KEYS`. Constant-time comparison
 * across all configured keys (no early return on mismatch). When the
 * env var is unset or empty, no header value is accepted.
 *
 * `null` is returned by `request.headers.get(...)` for missing
 * headers; the caller passes that through unchanged.
 */
export function isValidWorkflowBearer(authHeader: string | null): boolean {
  if (!authHeader) return false
  if (!BEARER_PREFIX.test(authHeader)) return false
  const presented = authHeader.replace(BEARER_PREFIX, "")
  if (presented.length === 0) return false

  const keys = parseAllowlist()
  if (keys.length === 0) return false

  // OR-fold across keys without short-circuiting so timing reveals
  // only "valid header? yes/no" — never which slot in the allowlist
  // matched. `timingSafeEqual` requires equal-length buffers, so
  // length-mismatched candidates are skipped explicitly (already a
  // safe failure mode — the real key length is not user-controlled).
  let matched = false
  const presentedBuf = Buffer.from(presented)
  for (const key of keys) {
    if (key.length !== presented.length) continue
    if (timingSafeEqual(presentedBuf, Buffer.from(key))) {
      matched = true
    }
  }
  return matched
}
