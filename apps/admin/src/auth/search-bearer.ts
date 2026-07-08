// Public-search bearer-key validator for admin's `/api/search` REST
// endpoint + `Query.search` GraphQL resolver.
//
// Composes the four "known-caller" bearer sources into one passport
// check. PARTNER (DB-backed via `verifyPartnerToken`) runs FIRST;
// CONSUMER, WORKFLOW (env-CSV) fall through. The legacy
// `SEARCH_API_KEYS` env-CSV branch was retired in Plan 003 (PR3) —
// today's partner credentials live in admin's `PartnerApiKey` table.
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

import {
  isValidConsumerBearer,
  type ConsumerBearerResult,
} from "@/auth/consumer-bearer"
import { isValidWorkflowBearer } from "@/auth/workflow-bearer"
import {
  sanitizeLogValue,
  verifyPartnerToken,
} from "@/services/partner-api-key.service"

/**
 * Branch identifier for the matched bearer source. Threads into the
 * structured per-request log so operators can grep
 * `auth=bearer source=partner` to see partner traffic, etc.
 */
export type BearerSource = "partner" | "consumer" | "fleet" | "workflow"

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
 * <key>` matches ANY of the three "known-caller" bearer sources:
 *
 *   1. **PARTNER** — DB-backed `PartnerApiKey` row (sha256 hash, parsed
 *      from the `jfp_search_<keyId>_<random>` token prefix). Runs FIRST
 *      so seeded rows match before any env-CSV fallback. Surfaces
 *      `keyId` for per-partner audit in the structured log.
 *   2. **CONSUMER** — `WEB_ADMIN_API_KEYS` env CSV (apps/web SSR
 *      rate-limit identity).
 *   3. **WORKFLOW** — `WORKFLOW_API_KEYS` env CSV (workflow-trigger;
 *      manager → admin proxies + the eval CLI's bearer mint).
 *
 * Rationale: the search-passport check answers "are you a known
 * caller?", not "do you have permission to call search?". Anyone
 * holding a workflow-trigger key (which can fire admin's most
 * privileged trigger mutations) or a consumer-bearer key (apps/web
 * SSR rate-limit identity) already proves they're a known caller —
 * requiring them to ALSO present a partner key would be incoherent.
 *
 * The disjointness invariant (`assertBearerCsvsDisjoint` at module
 * load in `env.ts`) holds across the ENV-var CSVs only.
 * `PartnerApiKey.keyHash` is uniqueness-enforced in Postgres, and a
 * key value seeded into the DB does not need to be disjoint from the
 * env CSVs (PARTNER runs first; same plaintext appearing in both is
 * tagged as `source=partner`).
 *
 * `BACKUP_DOWNLOAD_API_KEYS` is excluded — that bearer is for a
 * narrow file-download surface, not active-API requests.
 *
 * Defense-in-depth: each composed validator is wrapped in
 * try/catch via `safeCheck` / `safeCheckAsync`. None of the three
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

  const consumer = safeConsumer(authHeader)
  if (consumer.valid) {
    // Fleet keys log as source=fleet (vs web SSR's source=consumer) so the
    // existing per-request search log lets F1 confirm fleet traffic in prod.
    return { valid: true, source: consumer.fleet ? "fleet" : "consumer" }
  }
  if (safeCheck("workflow", () => isValidWorkflowBearer(authHeader))) {
    return { valid: true, source: "workflow" }
  }
  return { valid: false }
}

function safeCheck(validatorName: string, check: () => boolean): boolean {
  try {
    return check()
  } catch (err) {
    // Plain-string format per `railway-logsv2-silences-nextjs-stdout-runtime-20260518`:
    // JSON-stringified payloads from runtime route handlers are silenced
    // on Railway logsV2. Never log the header value — only the error message,
    // sanitized to strip CR/LF/TAB so a thrown message can't inject log
    // structure (`log-injection-sanitizer-user-input-structured-logs-20260429`).
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[search] event=search_bearer.validator_threw validator=${validatorName} error=${sanitizeLogValue(message)}`,
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
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[search] event=search_bearer.validator_threw validator=${validatorName} error=${sanitizeLogValue(message)}`,
    )
    return { valid: false }
  }
}

/**
 * Consumer-bearer check that returns the full result (including the `fleet`
 * discriminant) instead of a bare boolean, wrapped in the same try/catch guard
 * as `safeCheck` so a validator throw can't 500 every search request.
 */
function safeConsumer(authHeader: string | null): ConsumerBearerResult {
  try {
    return isValidConsumerBearer(authHeader)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[search] event=search_bearer.validator_threw validator=consumer error=${sanitizeLogValue(message)}`,
    )
    return { valid: false, bucketKey: null }
  }
}
