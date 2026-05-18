// Public-search bearer-key validator for admin's `/api/search` REST
// endpoint + `Query.search` GraphQL resolver.
//
// Companion to `workflow-bearer.ts` (workflow-trigger principal mint)
// and `consumer-bearer.ts` (apps/web SSR rate-limit identity). This
// module is the simpler bearer-token surface used by known callers
// (apps/web, apps/mobile, eval harness, external partners) to prove
// they're a known caller of `/api/search`. A matched key tags the
// request `auth=bearer source=<branch>` (with `keyId=<id>` for partner
// matches) in the structured log; when `SEARCH_AUTH_REQUIRED === "true"`,
// missing/invalid bearer returns 401.
//
// CRITICAL: the search bearer carries NO permissions and NO rate-limit
// identity (per-IP rate limiting at 30/min stays for both authed and
// anonymous traffic — see `apps/admin/src/auth/rate-limit.ts`). Its
// sole role is the request-level passport check at two seams.
//
// SECURITY: NEVER log the raw `Authorization` header value or matched
// key. The structured log emits only `auth=…` + `source=…` and (for
// partner matches) `keyId=…` from the token prefix — never plaintext
// or the stored hash.
//
// The OR-composer runs the DB-backed PARTNER branch FIRST so the seeded
// row matches before the env-CSV `search` fallback fires (today's
// `xoSP…` key is imported into the DB via `partner-keys import-from-env`
// before the env CSV is retired in PR3). The `search` branch is the
// legacy `SEARCH_API_KEYS` env-CSV fallback — removed in PR3 once a
// deploy cycle of `source=search` log evidence shows no remaining
// callers depend on it.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"
import { isValidConsumerBearer } from "@/auth/consumer-bearer"
import { isValidWorkflowBearer } from "@/auth/workflow-bearer"
import { verifyPartnerToken } from "@/services/partner-api-key.service"

const BEARER_PREFIX = /^Bearer\s+/i

// Defense-in-depth upper bound on the Authorization header value.
// Node's HTTP parser caps total header size around 8-16 KB, so this
// is rarely reached in practice — but guards the per-iteration
// `Buffer.from(presented)` allocation against pathological inputs and
// surfaces a clean `false` instead of multi-MB allocation on hostile
// callers. Real opaque-random keys are ~43 chars (32 bytes base64url);
// 1024 is generous headroom for the eventual prefixed-token format.
const MAX_BEARER_LENGTH = 1024

// Duplicated by design across the three bearer modules
// (search-bearer.ts, consumer-bearer.ts, workflow-bearer.ts). The
// `permissions.test.ts` source-grep asserts each module reads ONLY
// its own env var — DRYing this into a shared helper would defeat the
// grep guard and silently widen the cross-CSV isolation boundary.
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
  if (authHeader.length > MAX_BEARER_LENGTH) return false
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
 * Branch identifier for the matched bearer source. Threads into the
 * structured per-request log so operators can grep
 * `auth=bearer source=partner` to see partner traffic, etc.
 */
export type BearerSource = "partner" | "search" | "consumer" | "workflow"

/**
 * Enriched return type from the composer. `keyId` is populated ONLY for
 * the `partner` branch (the DB-backed store carries an operator-visible
 * identifier per row). All other branches surface only `source`.
 */
export type BearerCheckResult =
  | { valid: true; source: BearerSource; keyId?: string }
  | { valid: false }

/**
 * Returns `{ valid: true, source, keyId? }` if `Authorization: Bearer
 * <key>` matches ANY of the four "known-caller" bearer sources:
 *
 *   1. **PARTNER** — DB-backed `PartnerApiKey` row (sha256 hash, parsed
 *      from the `jfp_search_<keyId>_<random>` token prefix). Runs FIRST
 *      so seeded rows match before the env-CSV fallback. Surfaces
 *      `keyId` for per-partner audit in the structured log.
 *   2. **CONSUMER** — `WEB_ADMIN_API_KEYS` env CSV (apps/web SSR
 *      rate-limit identity).
 *   3. **WORKFLOW** — `WORKFLOW_API_KEYS` env CSV (workflow-trigger;
 *      manager → admin proxies + the eval CLI's bearer mint).
 *   4. **SEARCH** — `SEARCH_API_KEYS` env CSV (the legacy partner
 *      fallback, retired in PR3 once today's `xoSP…` key is migrated
 *      via `partner-keys import-from-env`).
 *
 * Rationale: the search-passport check answers "are you a known
 * caller?", not "do you have permission to call search?". Anyone
 * holding a workflow-trigger key (which can fire admin's most
 * privileged trigger mutations) or a consumer-bearer key (apps/web
 * SSR rate-limit identity) already proves they're a known caller —
 * requiring them to ALSO present a SEARCH_API_KEY would be
 * incoherent.
 *
 * The disjointness invariant (`assertBearerCsvsDisjoint` at module
 * load in `env.ts`) holds across the ENV-var CSVs only. A
 * partner-key plaintext that ALSO appears in an env CSV would match
 * both branches; the partner branch runs first so the matched
 * `source` will report `partner` in that ambiguous case (the
 * dual-accept window during the `xoSP…` migration is exactly this
 * shape — same plaintext, two backing stores).
 *
 * `BACKUP_DOWNLOAD_API_KEYS` is excluded — that bearer is for a
 * narrow file-download surface, not active-API requests.
 *
 * Defense-in-depth: each composed validator is wrapped in
 * try/catch via `safeCheck` / `safeCheckAsync`. None of the four
 * are expected to throw, but a future logging side-effect or
 * refactor introducing any throw path would otherwise convert a
 * single buggy validator into a 500 on EVERY search request.
 *
 * Async because the partner branch makes a Prisma lookup with a
 * `Promise.race`-wrapped 1500ms timeout — the env-CSV branches
 * remain synchronous and trivially fast.
 */
export async function isAnyKnownBearer(
  authHeader: string | null,
): Promise<BearerCheckResult> {
  // PARTNER (DB-backed) first — the prefix parse is cheap and falls
  // through (no DB call) for tokens that aren't `jfp_search_*`-shaped,
  // so the hot path for env-CSV tokens stays sub-millisecond.
  const partner = await safeCheckAsync("partner", () =>
    verifyPartnerToken(authHeader),
  )
  if (partner.valid) {
    return { valid: true, source: "partner", keyId: partner.keyId }
  }

  if (safeCheck("consumer", () => isValidConsumerBearer(authHeader).valid)) {
    return { valid: true, source: "consumer" }
  }
  if (safeCheck("workflow", () => isValidWorkflowBearer(authHeader))) {
    return { valid: true, source: "workflow" }
  }
  if (safeCheck("search", () => isValidSearchBearer(authHeader))) {
    return { valid: true, source: "search" }
  }
  return { valid: false }
}

function safeCheck(validatorName: string, check: () => boolean): boolean {
  try {
    return check()
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "search_bearer.validator_threw",
        validator: validatorName,
        // Never log the header value — only the error message.
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return false
  }
}

async function safeCheckAsync(
  validatorName: string,
  check: () => Promise<{ valid: true; keyId?: string } | { valid: false }>,
): Promise<{ valid: true; keyId?: string } | { valid: false }> {
  try {
    return await check()
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "search_bearer.validator_threw",
        validator: validatorName,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { valid: false }
  }
}
