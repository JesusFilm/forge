// Bearer-token authenticator for the admin → manager
// `/api/admin-trigger/{scene-analysis,transcript}` endpoints (feat-119
// PR2). Mirrors the receiver-side shape of admin's `workflow-bearer.ts`
// (CSV allowlist + timing-safe compare across same-length entries) and
// inverts the direction of `apps/manager/src/lib/admin-embed-trigger.ts`
// (which is the manager → admin outbound client for the embed-trigger
// proxy).
//
// Two callers are expected, both server-side bearer flows. There is
// deliberately no Strapi JWT cookie path: this surface exists to be
// invoked by admin's outbound HTTPS client, not by interactive sessions.
//
// 503 is returned (not 401) when ADMIN_TRIGGER_API_KEYS is unset, so
// operators can distinguish "manager not configured to receive
// triggers" from "your bearer is wrong" without grepping logs. The
// admin-side `manager-trigger.service.ts` consumes the discriminated
// envelope and surfaces 503 → DISPATCH_FAILED with reason
// `config_missing` per request.

import { timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const BEARER_PREFIX = "Bearer "

export type AdminTriggerAuthResult =
  | { ok: true }
  | { ok: false; status: 401; message: string }
  | { ok: false; status: 503; message: string }

function parseAllowlist(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

type CsvBearerAuthOptions = {
  request: Request
  csv: string | undefined
  configName: string
}

export function validateCsvBearer({
  request,
  csv,
  configName,
}: CsvBearerAuthOptions): AdminTriggerAuthResult {
  if (!csv) {
    return {
      ok: false,
      status: 503,
      message: `config_missing: ${configName} not set on apps/manager`,
    }
  }

  const authHeader = request.headers.get("authorization")
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    return {
      ok: false,
      status: 401,
      message: "Authorization required",
    }
  }

  const presented = authHeader.slice(BEARER_PREFIX.length)
  if (presented.length === 0) {
    return { ok: false, status: 401, message: "Invalid bearer token" }
  }

  const candidates = parseAllowlist(csv)
  if (candidates.length === 0) {
    return {
      ok: false,
      status: 503,
      message: `config_missing: ${configName} contains no usable keys`,
    }
  }

  let matched = false
  const presentedBuf = Buffer.from(presented)
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate)
    if (candidateBuf.length !== presentedBuf.length) continue
    if (timingSafeEqual(presentedBuf, candidateBuf)) {
      matched = true
    }
  }

  if (matched) return { ok: true }
  return { ok: false, status: 401, message: "Invalid bearer token" }
}

/**
 * Validate `Authorization: Bearer <key>` against the
 * `ADMIN_TRIGGER_API_KEYS` allowlist. Iterates the full allowlist
 * without short-circuiting on first match so timing does not reveal
 * which slot matched. Length-mismatched candidates are skipped (the
 * key length is operator-chosen and not the secret), so timing is
 * constant-time only across same-length entries — the practical
 * guarantee for high-entropy fixed-length keys.
 *
 * Length comparison uses `Buffer.byteLength` so a non-ASCII allowlist
 * entry (UTF-8 byte length ≠ UTF-16 code-unit length) does not pass
 * the guard and then crash inside `timingSafeEqual`'s equal-length
 * precondition.
 */
export function validateAdminTriggerBearer(
  request: Request,
): AdminTriggerAuthResult {
  return validateCsvBearer({
    request,
    csv: env.ADMIN_TRIGGER_API_KEYS,
    configName: "ADMIN_TRIGGER_API_KEYS",
  })
}

export function validateEnrichmentCallbackBearer(
  request: Request,
): AdminTriggerAuthResult {
  return validateCsvBearer({
    request,
    csv: env.ENRICHMENT_CALLBACK_API_KEYS,
    configName: "ENRICHMENT_CALLBACK_API_KEYS",
  })
}

export function assertBearerCsvsDisjoint(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const leftKeys = new Set(parseAllowlist(left))
  return parseAllowlist(right).every((key) => !leftKeys.has(key))
}
