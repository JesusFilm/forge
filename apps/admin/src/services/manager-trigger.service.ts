// Outbound HTTPS client for admin → manager enrichment trigger
// (feat-119 PR2). The first admin → manager outbound dispatch in
// the repo. Until now, admin only consumed manager's S3 artifacts;
// this is the deliberate seam where admin asks manager to PRODUCE
// upstream pipeline output (scene-analysis or transcript) for a
// list of cms videos.
//
// Caller pattern:
//   const results = await triggerManagerEnrichment(
//     [{ assetId: 1, coreId: "core-A" }],
//     "scene-analysis",
//   )
//   for (const r of results) {
//     // r.status ∈ "STARTED" | "ALREADY_IN_FLIGHT" | "NOT_FOUND"
//     //          | "VALIDATION_FAILED" | "DISPATCH_FAILED"
//   }
//
// The function never throws on transport / auth / config failure —
// instead returns a synthetic `[{ assetId, status:
// "DISPATCH_FAILED", error }, ...]` entry per requested item so
// the resolver's response stays a flat per-id array. This mirrors
// the discriminated-envelope shape the reverse-direction
// `apps/manager/src/lib/admin-embed-trigger.ts` uses.
//
// Mirroring (inverse direction):
//   - manager → admin reverse-direction client lives at
//     apps/manager/src/lib/admin-embed-trigger.ts. Same envelope
//     shape (`messages`, `retryable`, `httpStatus` discriminator).
//
// Hard timeout: AbortSignal.timeout(15_000). Manager's
// `/api/admin-trigger/{kind}` is a dispatcher (validates +
// schedules via after() + returns within ~100ms on the happy
// path). 15s ceiling is generous for the happy path and bounds
// hung-edge / stuck-pod scenarios that would otherwise pin admin
// resolver workers.

import { env } from "@/config/env"

const MANAGER_FETCH_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Public envelope shape (identical regardless of which kind dispatched).
// Per-id outcome — the GraphQL JSON return type echoes this verbatim.
// ---------------------------------------------------------------------------

export type ManagerEnrichmentDispatchStatus =
  | "STARTED"
  | "ALREADY_IN_FLIGHT"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "DISPATCH_FAILED"

export type ManagerEnrichmentDispatchResult = {
  assetId: number
  coreId: string
  managerJobId: string | null
  status: ManagerEnrichmentDispatchStatus
  /** Free-form failure detail when status is `DISPATCH_FAILED` /
   *  `VALIDATION_FAILED` / `NOT_FOUND`. Undefined for happy paths. */
  error?: string
  /** Underlying classification when status is `DISPATCH_FAILED`.
   *  Mirror of the reverse-direction client's
   *  `AdminTriggerEnvelope.reason`. */
  reason?:
    | "config_missing"
    | "graphql_error"
    | "network_error"
    | "parse_error"
    | "auth_failed"
    | "remote_5xx"
    | "remote_4xx"
  /** True for transient transport errors that are safe to retry. */
  retryable?: boolean
}

export type ManagerEnrichmentKind = "scene-analysis" | "transcript"

export type ManagerEnrichmentTriggerItem = {
  assetId: number
  coreId: string
}

// ---------------------------------------------------------------------------
// Manager response shape — discriminated per-id by `status`. Aligned
// with apps/manager/src/lib/admin-trigger-route.ts `AdminTriggerResult`.
// ---------------------------------------------------------------------------

type ManagerPerIdResult = {
  assetId: number
  coreId: string
  managerJobId: string | null
  status: "started" | "already_in_flight" | "not_found" | "validation_failed"
  message?: string
}

type ManagerSuccessBody = {
  results: ManagerPerIdResult[]
}

const STATUS_MAP: Record<
  ManagerPerIdResult["status"],
  ManagerEnrichmentDispatchStatus
> = {
  started: "STARTED",
  already_in_flight: "ALREADY_IN_FLIGHT",
  not_found: "NOT_FOUND",
  validation_failed: "VALIDATION_FAILED",
}

// Statuses on which manager's optional `message` field carries a
// failure reason worth surfacing as an `error` on the admin envelope.
// We DO NOT propagate `message` on `started` / `already_in_flight`
// because admin consumers (CLI, future dashboards) may gate on
// `error` being set as a failure signal.
const FAILURE_STATUSES = new Set<ManagerPerIdResult["status"]>([
  "not_found",
  "validation_failed",
])

function mapManagerResult(
  r: ManagerPerIdResult,
): ManagerEnrichmentDispatchResult {
  const mapped = STATUS_MAP[r.status]
  if (!mapped) {
    // Unknown status: a future manager deploy added a literal admin
    // doesn't yet know about. Don't widen the type at runtime —
    // surface as DISPATCH_FAILED with a parse-shaped reason so
    // callers' existing error-path branches engage. Without this
    // guard, `STATUS_MAP[r.status]` returns `undefined`, the
    // GraphQL JSON return ships `status: undefined` (silently
    // dropped by JSON.stringify), and the CLI's `summarise()`
    // treats it as a no-op.
    return {
      assetId: r.assetId,
      coreId: r.coreId,
      managerJobId: r.managerJobId,
      status: "DISPATCH_FAILED",
      reason: "parse_error",
      retryable: false,
      error: `manager returned unknown status: ${String(r.status).slice(0, 64)}`,
    }
  }
  const propagateMessage =
    r.message !== undefined && FAILURE_STATUSES.has(r.status)
  return {
    assetId: r.assetId,
    coreId: r.coreId,
    managerJobId: r.managerJobId,
    status: mapped,
    ...(propagateMessage ? { error: r.message } : {}),
  }
}

function syntheticDispatchFailure(
  items: readonly ManagerEnrichmentTriggerItem[],
  partial: {
    error: string
    reason: ManagerEnrichmentDispatchResult["reason"]
    retryable: boolean
  },
): ManagerEnrichmentDispatchResult[] {
  return items.map((item) => ({
    assetId: item.assetId,
    coreId: item.coreId,
    managerJobId: null,
    status: "DISPATCH_FAILED",
    error: partial.error,
    reason: partial.reason,
    retryable: partial.retryable,
  }))
}

function logResults(
  kind: ManagerEnrichmentKind,
  durationMs: number,
  results: readonly ManagerEnrichmentDispatchResult[],
): void {
  // One JSON line per result for grep-friendly log inspection.
  for (const r of results) {
    console.log(
      JSON.stringify({
        event: "enrichment_triggered",
        kind,
        assetId: r.assetId,
        coreId: r.coreId,
        status: r.status,
        managerJobId: r.managerJobId,
        durationMs,
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.error ? { error: r.error } : {}),
      }),
    )
  }
}

/**
 * Dispatch a list of (assetId, coreId) pairs to apps/manager's
 * `/api/admin-trigger/{kind}` endpoint. The manager resolves dispatch
 * metadata from admin by coreId and schedules the matching pipeline
 * (scene-analysis or transcript-only) in the background.
 *
 * Returns one result per requested item — the function never
 * partial-fails. On HTTP non-2xx, network error, parse error, or
 * missing-env, every item gets a synthetic `DISPATCH_FAILED`
 * outcome with a typed `reason`.
 */
export async function triggerManagerEnrichment(
  items: readonly ManagerEnrichmentTriggerItem[],
  kind: ManagerEnrichmentKind,
): Promise<ManagerEnrichmentDispatchResult[]> {
  const startedAt = Date.now()

  if (items.length === 0) {
    // Manager would 400 on empty `items`; do not waste a round trip.
    return []
  }

  // Pre-dedupe by assetId so the admin caller's per-id outcome list
  // length matches what manager will respond with. Manager dedupes
  // the same way at its boundary; without admin doing the same, a
  // duplicate assetId in the input would cause manager's response
  // array to be SHORTER than the request, forcing a synthetic
  // outcome with no clean status to assign. Dedupe at both
  // boundaries keeps the per-id outcome contract honest.
  const seen = new Set<number>()
  const dedupedItems = items.filter((item) => {
    if (seen.has(item.assetId)) return false
    seen.add(item.assetId)
    return true
  })

  if (!env.MANAGER_API_BASE_URL || !env.MANAGER_TRIGGER_API_KEY) {
    const results = syntheticDispatchFailure(dedupedItems, {
      error:
        "config_missing: MANAGER_API_BASE_URL and MANAGER_TRIGGER_API_KEY must be set on apps/admin",
      reason: "config_missing",
      retryable: false,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  const url = `${env.MANAGER_API_BASE_URL.replace(/\/+$/, "")}/api/admin-trigger/${kind}`
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.MANAGER_TRIGGER_API_KEY}`,
      },
      body: JSON.stringify({ items: dedupedItems }),
      signal: AbortSignal.timeout(MANAGER_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    const message = error instanceof Error ? error.message : String(error)
    const results = syntheticDispatchFailure(dedupedItems, {
      error: isTimeout
        ? `manager request timed out after ${MANAGER_FETCH_TIMEOUT_MS}ms`
        : `network_error: ${message}`,
      reason: "network_error",
      retryable: true,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  if (response.status === 401 || response.status === 403) {
    const results = syntheticDispatchFailure(dedupedItems, {
      error: `auth_failed: manager rejected bearer (status ${response.status})`,
      reason: "auth_failed",
      retryable: false,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  if (response.status === 503) {
    const results = syntheticDispatchFailure(dedupedItems, {
      error: `config_missing: manager not configured to receive admin triggers (status 503)`,
      reason: "config_missing",
      retryable: false,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<unreadable body>")
    const reason: ManagerEnrichmentDispatchResult["reason"] =
      response.status >= 500 ? "remote_5xx" : "remote_4xx"
    const results = syntheticDispatchFailure(dedupedItems, {
      error: `${reason}: manager returned ${response.status}: ${text.slice(0, 500)}`,
      reason,
      retryable: response.status >= 500,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  let payload: ManagerSuccessBody
  try {
    payload = (await response.json()) as ManagerSuccessBody
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const results = syntheticDispatchFailure(dedupedItems, {
      error: `parse_error: ${message}`,
      reason: "parse_error",
      retryable: true,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  if (!payload || !Array.isArray(payload.results)) {
    const results = syntheticDispatchFailure(dedupedItems, {
      error: "parse_error: manager response missing `results` array",
      reason: "parse_error",
      retryable: true,
    })
    logResults(kind, Date.now() - startedAt, results)
    return results
  }

  const mapped = payload.results.map(mapManagerResult)
  // Defense-in-depth: caller dedupes BEFORE the request (above) so
  // request and response array lengths should always match. If
  // manager ever drops a result for an assetId we sent (a contract
  // bug worth surfacing rather than masking with synthetic
  // NOT_FOUND), fall through to a typed DISPATCH_FAILED so the
  // operator sees a real error.
  const seenInResponse = new Set<number>(mapped.map((r) => r.assetId))
  const dropped = dedupedItems.filter((it) => !seenInResponse.has(it.assetId))
  const filled = [
    ...mapped,
    ...dropped.map(
      (it): ManagerEnrichmentDispatchResult => ({
        assetId: it.assetId,
        coreId: it.coreId,
        managerJobId: null,
        status: "DISPATCH_FAILED",
        reason: "parse_error",
        retryable: false,
        error:
          "manager response did not include an outcome for this assetId — possible contract drift",
      }),
    ),
  ]

  logResults(kind, Date.now() - startedAt, filled)
  return filled
}
