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
 * keys configured in `WORKFLOW_API_KEYS`. Iterates the full allowlist
 * without short-circuiting on first match, so timing does not reveal
 * which slot matched. Length-mismatched candidates are skipped (the
 * real key length is operator-chosen and not the secret), so timing
 * is constant-time only across same-length entries — which is the
 * practical guarantee for high-entropy fixed-length keys. When the
 * env var is unset or empty, no header value is accepted.
 *
 * Length comparison uses `Buffer.byteLength` so a non-ASCII allowlist
 * entry (UTF-8 byte length ≠ UTF-16 code-unit length) does not pass
 * the guard and then crash inside `timingSafeEqual`'s equal-length
 * precondition — the call would otherwise throw `RangeError` and
 * surface as a 500 from `createContext`.
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
