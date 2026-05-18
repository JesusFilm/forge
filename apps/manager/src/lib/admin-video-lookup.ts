// Manager → admin GraphQL lookup for video dispatch fields (feat-125).
//
// Replaces the Apollo-to-Strapi query that lived in
// `admin-trigger-route.ts::lookupVideosByCoreId`. Mirrors the
// `admin-embed-trigger.ts` shape verbatim — bearer + 15s
// AbortSignal.timeout + discriminated AdminVideoLookupEnvelope — so
// the failure-mode contract is identical to the inverse direction.
//
// Why fetch instead of Apollo: the existing `cms/client.ts` Apollo
// singleton is bound to Strapi's GraphQL surface + STRAPI_API_TOKEN;
// reusing it would entangle two upstream targets in one client.
// `admin-embed-trigger.ts` is the established repo pattern for
// manager → admin outbound HTTPS.
//
// Env (validated at module load via @/config/env):
//   - ADMIN_GRAPHQL_URL          full URL of admin's /api/graphql
//   - ADMIN_EMBED_TRIGGER_API_KEY  matches one of admin's WORKFLOW_API_KEYS
//
// The bearer key is reused from the inverse direction (no new env
// coordination) — admin's WORKFLOW_TRIGGER allowlist (feat-125) now
// grants `read:video-metadata` to the same set of keys.
//
// Failure shape: every non-ok variant carries `messages: string[]` +
// `retryable: boolean` so the caller in `admin-trigger-route.ts` can
// fan-in to a 502 / 503 response without per-variant branching.

import { env } from "@/config/env"

// Strictly less than admin's caller budget (admin's
// `manager-trigger.service.ts::MANAGER_FETCH_TIMEOUT_MS = 15_000`,
// the outbound timeout on admin → manager). Per the
// `outbound-timeout-shorter-than-caller-budget-20260506` learning,
// inner timeouts must be shorter than the upstream caller's
// ceiling — otherwise the upstream classifier wins the race and
// triggers a retry storm while the inner call keeps running. 10s
// leaves a 5s headroom for manager's own deserialization + response
// write within admin's 15s budget.
const ADMIN_FETCH_TIMEOUT_MS = 10_000

/**
 * Dispatch-fields projection mirrored from admin's
 * `VideoForEnrichment` GraphQL type. Field nullability matches the
 * SDL: `id` and `coreId` are non-null; the rest are nullable
 * because admin returns null when the relevant primary-language
 * variant/subtitle does not exist.
 *
 * MUST stay structurally in sync with admin's
 * `VideoForEnrichment` (apps/admin/src/services/video.service.ts +
 * the SDL emitted by apps/admin/schema.graphql). No compile-time
 * check links the two; drift only surfaces at runtime via the
 * `graphql_error` envelope branch.
 */
export type VideoForEnrichment = {
  id: string
  coreId: string
  label: string | null
  primaryLanguageBcp47: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

export type AdminVideoLookupEnvelope =
  | { ok: true; data: Map<string, VideoForEnrichment> }
  | {
      ok: false
      reason: "config_missing"
      messages: string[]
      retryable: false
    }
  | {
      ok: false
      reason: "graphql_error"
      messages: string[]
      httpStatus: number
      retryable: false
    }
  | {
      ok: false
      reason: "network_error"
      messages: string[]
      retryable: true
    }
  | {
      ok: false
      reason: "parse_error"
      messages: string[]
      httpStatus: number
      retryable: true
    }

const VIDEOS_BY_CORE_IDS_QUERY = /* GraphQL */ `
  query VideosByCoreIds($coreIds: [String!]!) {
    videosByCoreIds(coreIds: $coreIds) {
      id
      coreId
      label
      primaryLanguageBcp47
      muxAssetId
      subtitleUrl
    }
  }
`

/**
 * Batched coreId → dispatch-fields lookup against admin's
 * `videosByCoreIds` query. Returns a discriminated envelope; never
 * throws on transport / auth / parse failure.
 *
 * The returned Map is keyed by coreId so the caller can probe
 * `videos.get(item.coreId)` and emit `not_found` for misses (the
 * same shape the previous Strapi lookup had).
 */
export async function lookupVideosByCoreIdFromAdmin(
  coreIds: readonly string[],
): Promise<AdminVideoLookupEnvelope> {
  // Config check FIRST so a misconfigured environment surfaces as
  // `config_missing` even on degenerate empty input — masking the
  // misconfig behind a happy-path empty Map would hide a real
  // operational bug from operators running probes.
  if (!env.ADMIN_GRAPHQL_URL || !env.ADMIN_EMBED_TRIGGER_API_KEY) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "ADMIN_GRAPHQL_URL and ADMIN_EMBED_TRIGGER_API_KEY must be set on apps/manager to look up videos via admin",
      ],
      retryable: false,
    }
  }

  // Empty input is cheap to short-circuit after the config check —
  // skip the network round-trip but only once the operator has
  // confirmed env is wired.
  if (coreIds.length === 0) {
    return { ok: true, data: new Map() }
  }

  let response: Response
  try {
    response = await fetch(env.ADMIN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.ADMIN_EMBED_TRIGGER_API_KEY}`,
      },
      body: JSON.stringify({
        query: VIDEOS_BY_CORE_IDS_QUERY,
        variables: { coreIds },
      }),
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      ok: false,
      reason: "network_error",
      messages: [
        isTimeout
          ? `admin GraphQL request timed out after ${ADMIN_FETCH_TIMEOUT_MS}ms`
          : messageText,
      ],
      retryable: true,
    }
  }

  let payload: {
    data?: { videosByCoreIds?: VideoForEnrichment[] | null }
    errors?: Array<{ message: string }>
  }
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["admin GraphQL endpoint returned invalid JSON"],
      httpStatus: response.status,
      retryable: true,
    }
  }

  if (payload.errors && payload.errors.length > 0) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: payload.errors.map((e) => e.message),
      httpStatus: response.status,
      retryable: false,
    }
  }

  const rows = payload.data?.videosByCoreIds
  if (rows === undefined || rows === null) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: [
        `admin GraphQL response missing data.videosByCoreIds (status ${response.status})`,
      ],
      httpStatus: response.status,
      retryable: false,
    }
  }

  const data = new Map<string, VideoForEnrichment>()
  for (const row of rows) {
    data.set(row.coreId, row)
  }
  return { ok: true, data }
}
