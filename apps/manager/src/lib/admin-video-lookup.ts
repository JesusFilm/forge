// Manager → admin lookup for video dispatch fields (feat-125 / feat-126).
//
// Replaces the Apollo-to-Strapi query that lived in
// `admin-trigger-route.ts::lookupVideosByCoreId`. Prefer the narrow
// admin REST route because production debugging showed GraphQL/Yoga
// request-path tail latency even though the underlying SQL projection
// was fast. Keep GraphQL as a deploy-order fallback when the REST
// route is not present yet.
//
// Why fetch instead of Apollo: `admin-embed-trigger.ts` is the established repo
// pattern for manager → admin outbound HTTPS.
//
// Env (validated at module load via @/config/env):
//   - ADMIN_GRAPHQL_URL          full URL of admin's /api/graphql
//                                (REST lookup URL is derived from it)
//   - ADMIN_EMBED_TRIGGER_API_KEY  matches one of admin's WORKFLOW_API_KEYS
//
// The bearer key is reused from the inverse direction (no new env
// coordination) — admin's WORKFLOW_TRIGGER allowlist (feat-125) now
// grants `read:video-metadata` to the same set of keys. The REST route
// accepts the same bearer via admin's WORKFLOW_API_KEYS allowlist.
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
  targetLocale?: string | null
  primaryLanguageBcp47: string | null
  languageBcp47?: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

export type AdminVideoLookupRequest = {
  coreId: string
  targetLocale?: string | null
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
      retryable: boolean
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
  query VideosByCoreIds($coreIds: [String!]!, $targetLocale: String) {
    videosByCoreIds(coreIds: $coreIds, targetLocale: $targetLocale) {
      id
      coreId
      label
      targetLocale
      primaryLanguageBcp47
      languageBcp47
      muxAssetId
      subtitleUrl
    }
  }
`

type RestLookupBody = {
  videos?: unknown
  error?: string
  details?: string
  reason?: string
  retryable?: boolean
}

type LookupRowsResult =
  | { ok: true; rows: VideoForEnrichment[] }
  | Extract<AdminVideoLookupEnvelope, { reason: "graphql_error" }>

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
  input: readonly string[] | readonly AdminVideoLookupRequest[],
): Promise<AdminVideoLookupEnvelope> {
  const requests = normalizeLookupRequests(input)
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
  const adminGraphqlUrl = env.ADMIN_GRAPHQL_URL
  const adminEmbedTriggerApiKey = env.ADMIN_EMBED_TRIGGER_API_KEY

  // Empty input is cheap to short-circuit after the config check —
  // skip the network round-trip but only once the operator has
  // confirmed env is wired.
  if (requests.length === 0) {
    return { ok: true, data: new Map() }
  }

  const restEnvelope = await lookupVideosByCoreIdFromAdminRest(requests, {
    adminGraphqlUrl,
    adminEmbedTriggerApiKey,
  })
  if (restEnvelope.ok || restEnvelope.httpStatus !== 404) {
    return restEnvelope
  }

  // Deploy-order fallback: if manager rolls before admin's narrow REST
  // route exists, keep the original GraphQL contract working. Any other
  // REST failure should surface directly so operators see the typed
  // failure rather than hiding it behind a second request.
  return lookupVideosByCoreIdFromAdminGraphql(requests, {
    adminGraphqlUrl,
    adminEmbedTriggerApiKey,
  })
}

function adminRestLookupUrl(adminGraphqlUrl: string): string {
  const url = new URL(adminGraphqlUrl)
  if (url.pathname.endsWith("/api/graphql")) {
    url.pathname = url.pathname.replace(
      /\/api\/graphql$/,
      "/api/manager/videos-by-core-ids",
    )
  } else {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/manager/videos-by-core-ids`
  }
  url.search = ""
  return url.toString()
}

async function lookupVideosByCoreIdFromAdminRest(
  requests: readonly AdminVideoLookupRequest[],
  config: {
    adminGraphqlUrl: string
    adminEmbedTriggerApiKey: string
  },
): Promise<AdminVideoLookupEnvelope & { httpStatus?: number }> {
  let response: Response
  try {
    response = await fetch(adminRestLookupUrl(config.adminGraphqlUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.adminEmbedTriggerApiKey}`,
      },
      // Include legacy `coreIds` for Manager-first deploys against the
      // already-existing Admin REST route. New Admin prefers `items`;
      // old Admin ignores it and returns source-language rows keyed
      // without targetLocale, so localized requests still fail closed
      // as not_found instead of spoofing source artifacts.
      body: JSON.stringify({
        coreIds: requests.map((request) => request.coreId),
        items: requests,
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
          ? `admin REST lookup request timed out after ${ADMIN_FETCH_TIMEOUT_MS}ms`
          : messageText,
      ],
      retryable: true,
    }
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: ["admin REST lookup route was not found"],
      httpStatus: response.status,
      retryable: false,
    }
  }

  let payload: RestLookupBody
  try {
    payload = (await response.json()) as RestLookupBody
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["admin REST lookup endpoint returned invalid JSON"],
      httpStatus: response.status,
      retryable: true,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: [
        payload.error ??
          payload.details ??
          `admin REST lookup returned status ${response.status}`,
      ],
      httpStatus: response.status,
      retryable: response.status >= 500 && payload.retryable !== false,
    }
  }

  const rows = payload.videos
  if (rows === undefined || rows === null) {
    return {
      ok: false,
      reason: "graphql_error",
      messages: [
        `admin REST lookup response missing videos (status ${response.status})`,
      ],
      httpStatus: response.status,
      retryable: false,
    }
  }
  const validatedRows = validateLookupRows(rows, "REST", response.status)
  if (!validatedRows.ok) return validatedRows

  return { ok: true, data: rowsToMap(validatedRows.rows) }
}

async function lookupVideosByCoreIdFromAdminGraphql(
  requests: readonly AdminVideoLookupRequest[],
  config: {
    adminGraphqlUrl: string
    adminEmbedTriggerApiKey: string
  },
): Promise<AdminVideoLookupEnvelope> {
  const rows: VideoForEnrichment[] = []
  for (const group of groupLookupRequestsByTargetLocale(requests)) {
    const envelope = await lookupVideosByCoreIdFromAdminGraphqlGroup(
      group,
      config,
    )
    if (!envelope.ok) return envelope
    rows.push(...envelope.rows)
  }
  return { ok: true, data: rowsToMap(rows) }
}

async function lookupVideosByCoreIdFromAdminGraphqlGroup(
  group: { targetLocale: string | null; coreIds: string[] },
  config: {
    adminGraphqlUrl: string
    adminEmbedTriggerApiKey: string
  },
): Promise<
  | { ok: true; rows: VideoForEnrichment[] }
  | Exclude<AdminVideoLookupEnvelope, { ok: true }>
> {
  let response: Response
  try {
    response = await fetch(config.adminGraphqlUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.adminEmbedTriggerApiKey}`,
      },
      body: JSON.stringify({
        query: VIDEOS_BY_CORE_IDS_QUERY,
        variables: {
          coreIds: group.coreIds,
          targetLocale: group.targetLocale,
        },
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
    data?: { videosByCoreIds?: unknown }
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
  const validatedRows = validateLookupRows(rows, "GraphQL", response.status)
  if (!validatedRows.ok) return validatedRows

  return {
    ok: true,
    rows: validatedRows.rows.map((row) => ({
      ...row,
      targetLocale: row.targetLocale ?? group.targetLocale,
    })),
  }
}

function rowsToMap(rows: readonly VideoForEnrichment[]) {
  const data = new Map<string, VideoForEnrichment>()
  for (const row of rows) {
    data.set(videoLookupKey(row.coreId, row.targetLocale ?? null), row)
  }
  return data
}

export function videoLookupKey(
  coreId: string,
  targetLocale: string | null | undefined,
): string {
  const normalizedTargetLocale = normalizeTargetLocale(targetLocale)
  return normalizedTargetLocale
    ? `${coreId}::${normalizedTargetLocale}`
    : coreId
}

function normalizeLookupRequests(
  input: readonly string[] | readonly AdminVideoLookupRequest[],
): AdminVideoLookupRequest[] {
  return input.map((item) =>
    typeof item === "string"
      ? { coreId: item, targetLocale: null }
      : {
          coreId: item.coreId,
          targetLocale: normalizeTargetLocale(item.targetLocale),
        },
  )
}

function normalizeTargetLocale(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized.toLowerCase() : null
}

function groupLookupRequestsByTargetLocale(
  requests: readonly AdminVideoLookupRequest[],
): Array<{ targetLocale: string | null; coreIds: string[] }> {
  const groups = new Map<
    string,
    { targetLocale: string | null; coreIds: string[] }
  >()
  for (const request of requests) {
    const targetLocale = normalizeTargetLocale(request.targetLocale)
    const key = targetLocale ?? ""
    let group = groups.get(key)
    if (!group) {
      group = { targetLocale, coreIds: [] }
      groups.set(key, group)
    }
    group.coreIds.push(request.coreId)
  }
  return [...groups.values()]
}

function validateLookupRows(
  rows: unknown,
  source: "REST" | "GraphQL",
  httpStatus: number,
): LookupRowsResult {
  if (!Array.isArray(rows)) {
    return invalidLookupRows(source, httpStatus)
  }

  if (!rows.every(isVideoForEnrichment)) {
    return invalidLookupRows(source, httpStatus)
  }

  return { ok: true, rows }
}

function invalidLookupRows(
  source: "REST" | "GraphQL",
  httpStatus: number,
): Extract<AdminVideoLookupEnvelope, { reason: "graphql_error" }> {
  return {
    ok: false,
    reason: "graphql_error",
    messages: [`admin ${source} lookup response had invalid video rows`],
    httpStatus,
    retryable: false,
  }
}

function isVideoForEnrichment(value: unknown): value is VideoForEnrichment {
  if (typeof value !== "object" || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === "string" &&
    typeof row.coreId === "string" &&
    isNullableString(row.label) &&
    (row.targetLocale === undefined || isNullableString(row.targetLocale)) &&
    isNullableString(row.primaryLanguageBcp47) &&
    (row.languageBcp47 === undefined || isNullableString(row.languageBcp47)) &&
    isNullableString(row.muxAssetId) &&
    isNullableString(row.subtitleUrl)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}
