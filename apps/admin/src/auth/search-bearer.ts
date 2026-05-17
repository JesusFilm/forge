// Public-search bearer-key validator for admin's `/api/search` REST
// endpoint + `Query.search` GraphQL resolver.
//
// Companion to `workflow-bearer.ts` (workflow-trigger principal mint)
// and `consumer-bearer.ts` (apps/web SSR rate-limit identity). This
// module is the simpler bearer-token surface used by known callers
// (apps/web, apps/mobile, eval harness, external partners) to prove
// they're a known caller of `/api/search`. A matched key tags the
// request `auth=bearer` in the structured log; when
// `SEARCH_AUTH_REQUIRED === "true"`, missing/invalid bearer returns 401.
//
// CRITICAL: the search bearer carries NO permissions and NO rate-limit
// identity (per-IP rate limiting at 30/min stays for both authed and
// anonymous traffic — see `apps/admin/src/auth/rate-limit.ts`). Its
// sole role is the request-level passport check at two seams.
//
// SECURITY: NEVER log the raw `Authorization` header value or matched
// key. The structured log emits only `auth=bearer|anonymous`.
//
// Upgrade path (deferred follow-up): when per-key audit becomes load-
// bearing, key format upgrades from opaque random base64url to
// `sk_search_<labeledKeyId>_<random>` and this validator parses the
// prefix to surface the keyId for per-request structured logging /
// per-key revocation. v1 is opaque and emits no keyId.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import { isValidConsumerBearer } from "@/auth/consumer-bearer"
import { isValidWorkflowBearer } from "@/auth/workflow-bearer"

const BEARER_PREFIX = /^Bearer\s+/i

function parseAllowlist(): string[] {
  if (!env.SEARCH_API_KEYS) return []
  return env.SEARCH_API_KEYS.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Returns true if `Authorization: Bearer <key>` matches one of the
 * keys configured in `SEARCH_API_KEYS`. Iterates the full allowlist
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
 * surface as a 500 from the route handler / resolver.
 *
 * `null` is returned by `request.headers.get(...)` for missing
 * headers; the caller passes that through unchanged.
 */
export function isValidSearchBearer(authHeader: string | null): boolean {
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

/**
 * Returns true if `Authorization: Bearer <key>` matches ANY of the
 * three "known-caller" bearer allowlists: `SEARCH_API_KEYS`,
 * `WEB_ADMIN_API_KEYS` (consumer-bearer), or `WORKFLOW_API_KEYS`
 * (workflow-trigger).
 *
 * Rationale: the search-passport check answers "are you a known
 * caller?", not "do you have permission to call search?". Anyone
 * holding a workflow-trigger key (which can fire admin's most
 * privileged trigger mutations) or a consumer-bearer key (apps/web
 * SSR rate-limit identity) already proves they're a known caller —
 * requiring them to ALSO present a SEARCH_API_KEY would be
 * incoherent. External partners get their own `SEARCH_API_KEYS`
 * slot; internal callers reuse the bearer they already carry.
 *
 * The disjointness invariant (`assertBearerCsvsDisjoint` at module
 * load in `env.ts`) is unaffected: each key VALUE still lives in
 * exactly one CSV. This function composes validators, not key sets.
 *
 * `BACKUP_DOWNLOAD_API_KEYS` is excluded — that bearer is for a
 * narrow file-download surface, not active-API requests. If a future
 * caller needs both backup and search access, they should hold a
 * `SEARCH_API_KEYS` entry alongside.
 */
export function isAnyKnownBearer(authHeader: string | null): boolean {
  return (
    isValidSearchBearer(authHeader) ||
    isValidConsumerBearer(authHeader).valid ||
    isValidWorkflowBearer(authHeader)
  )
}
