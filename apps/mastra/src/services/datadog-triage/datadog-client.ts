import { z } from "zod"

import {
  DATADOG_TRIAGE_ALLOWED_SITES,
  datadogApiBaseUrl,
  type DatadogTriageConfig,
} from "../../config/env"
import { discardResponseBody } from "../devotional/bounded-response"

import {
  BOUNDED_READ_OVER_CAP,
  readJsonBodyCappedOrThrow,
} from "./bounded-read"

/**
 * Read-only Datadog client for the hourly triage sweep (U3, KTD5).
 *
 * Three surfaces, all reads: Error Tracking issue search, the monitors list,
 * and one bounded logs/RUM aggregate. Nothing here mutates Datadog —
 * R13's read-only boundary is a property of the endpoint set, not a runtime
 * check — so `ambiguous` is always false: a failed request never leaves a
 * half-applied write behind.
 *
 * ── Contract verification status (read before editing a schema) ─────────────
 *
 * VERIFIED live 2026-08-19 through the Datadog MCP against the real
 * `forge-mobile` project: issue search returns, per issue, a `total_count` for
 * the queried window alongside `issue_id`, `state`, `service`, `error_type`,
 * `error_message`, `first_seen`/`last_seen`, `first_seen_version`/
 * `last_seen_version`, `is_crash`, `file_path`, and `platform`. That settles
 * the plan's open Dependencies assumption — per-issue windowed counts exist,
 * so the fallback per-issue aggregate is NOT needed.
 *
 * NOT VERIFIED: the raw HTTP envelope. The MCP returns its own flattened
 * projection, so the JSON:API `data[].attributes` + `included[]` wrapping
 * modelled below comes from the API documentation, not from an observed
 * response. Two consequences are deliberate: `issueSearchEnvelopeSchema`
 * accepts a row whose fields sit either under `attributes` or directly on the
 * row, and every row that yields no usable issue id is COUNTED as
 * `unparsedRows` rather than dropped in silence — envelope drift then shows up
 * in the run report and the runbook's liveness check instead of looking like a
 * quiet day. Confirming the envelope is a named step of the pre-enable
 * operational smoke in `docs/runbooks/datadog-mobile-triage.md`.
 */

export type DatadogFailureReason =
  | "config_missing"
  | "invalid_config"
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "rejected"
  | "parse_error"
  | "response_too_large"

export type DatadogRateLimit = {
  limit?: number
  remaining?: number
  resetSeconds?: number
}

export type DatadogFailure = {
  ok: false
  reason: DatadogFailureReason
  retryable: boolean
  /** Always false: every surface here is a read, so nothing can half-apply. */
  ambiguous: false
  status?: number
  retryAfterSeconds?: number
  rateLimit?: DatadogRateLimit
}

export type DatadogSuccess<T> = {
  ok: true
  value: T
  rateLimit?: DatadogRateLimit
}

export type DatadogResult<T> = DatadogSuccess<T> | DatadogFailure

export type DatadogIssue = {
  issueId: string
  service?: string
  state?: string
  errorType?: string
  errorMessage?: string
  filePath?: string
  functionName?: string
  platform?: string
  isCrash?: boolean
  firstSeen?: string
  lastSeen?: string
  firstSeenVersion?: string
  lastSeenVersion?: string
  totalCount: number
}

export type DatadogIssuePage = {
  issues: DatadogIssue[]
  /**
   * Rows the envelope schema accepted but that carried no usable issue id OR
   * no readable occurrence count. Both are fields detection depends on, so a
   * rename in either must be loud rather than read as a quiet hour.
   */
  unparsedRows: number
  /**
   * The search followed its cursor but still could not exhaust the window:
   * either the page cap was reached, or a full page exposed no cursor to
   * follow. A baseline seeded from such a read would treat every issue it did
   * not see as brand new on the following run (AE5), so the caller refuses to
   * seed AND holds the cursor on it.
   */
  truncated: boolean
}

export type DatadogMonitor = {
  monitorId: string
  name?: string
  overallState?: string
  overallStateModified?: string
  tags: string[]
}

export type DatadogMonitorPage = {
  monitors: DatadogMonitor[]
  unparsedRows: number
}

export type DatadogAggregateBucket = {
  key: string
  count: number
}

export type DatadogAggregate = {
  buckets: DatadogAggregateBucket[]
  /**
   * True when the upstream answered 200 with `meta.status: "timeout"`. The
   * numbers are then a partial view of the window and must never update a
   * baseline (KTD3).
   */
  partial: boolean
}

/** Maximum rows requested per page. Datadog caps analytics pages at 1000. */
export const DATADOG_ISSUE_PAGE_LIMIT = 100
export const DATADOG_MONITOR_PAGE_LIMIT = 200

/**
 * Pages followed per issue search before the read is called truncated. Ten
 * pages is 1000 issues — far past any plausible mobile service, while bounding
 * the worst case to ten sequential requests inside the run's own budget.
 * A service that genuinely exceeds it wants a shorter
 * `DATADOG_TRIAGE_BASELINE_LOOKBACK_MS`, not a higher cap.
 */
export const DATADOG_ISSUE_MAX_PAGES = 10

type DatadogClientConfig = Pick<
  DatadogTriageConfig,
  "site" | "apiKey" | "applicationKey" | "timeoutMs" | "maxResponseBytes"
>

const issueAttributesSchema = z
  .object({
    issue_id: z.unknown(),
    id: z.unknown(),
    service: z.unknown(),
    state: z.unknown(),
    error_type: z.unknown(),
    error_message: z.unknown(),
    file_path: z.unknown(),
    function_name: z.unknown(),
    platform: z.unknown(),
    is_crash: z.unknown(),
    first_seen: z.unknown(),
    last_seen: z.unknown(),
    first_seen_version: z.unknown(),
    last_seen_version: z.unknown(),
    total_count: z.unknown(),
  })
  .partial()
  .passthrough()

const issueRowSchema = z
  .object({
    id: z.unknown(),
    attributes: issueAttributesSchema.optional(),
  })
  .passthrough()

// `data` is REQUIRED on purpose: `.default([])` let a moved array parse as a
// clean empty page, which is the silent death this module exists to prevent.
// A genuinely empty result sends `[]`.
const issueSearchEnvelopeSchema = z
  .object({
    data: z.array(issueRowSchema),
    included: z.array(issueRowSchema).optional(),
    // Two spellings because the envelope is UNVERIFIED (module header). Both
    // optional: an unknown third spelling stops paging and still reports
    // `truncated`, degrading to the old behaviour rather than to silence.
    meta: z
      .object({
        status: z.unknown(),
        page: z.object({ after: z.unknown() }).passthrough().nullish(),
        pagination: z
          .object({ next_cursor: z.unknown() })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()

function nextIssueCursor(
  envelope: z.infer<typeof issueSearchEnvelopeSchema>,
): string | undefined {
  return (
    asString(envelope.meta?.page?.after) ??
    asString(envelope.meta?.pagination?.next_cursor)
  )
}

const monitorRowSchema = z
  .object({
    id: z.unknown(),
    name: z.unknown(),
    overall_state: z.unknown(),
    overall_state_modified: z.unknown(),
    tags: z.unknown(),
  })
  .passthrough()

const aggregateEnvelopeSchema = z
  .object({
    // Both levels are required: a rename at EITHER `data` or `buckets` must
    // fail loudly. Optional here reads as zero activity forever, which looks
    // like a healthy quiet service on every operator surface.
    data: z
      .object({
        buckets: z.array(
          z
            .object({
              by: z.record(z.string(), z.unknown()).optional(),
              computes: z.record(z.string(), z.unknown()).optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    meta: z.object({ status: z.unknown() }).passthrough().nullish(),
  })
  .passthrough()

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asIsoTimestamp(value: unknown): string | undefined {
  const text = asString(value)
  if (text) {
    const parsed = Date.parse(text)
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
  }
  const epoch = asNumber(value)
  if (epoch === undefined) return undefined
  // Datadog mixes second and millisecond epochs across surfaces; anything
  // below ~1e12 is far too small to be a plausible millisecond timestamp.
  const millis = epoch < 1e12 ? epoch * 1000 : epoch
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Reject any host the operator did not configure through the site allowlist,
 * before a credential is attached. The site is already checked at readiness;
 * re-checking the resolved URL here keeps the guard total for a direct caller.
 */
function resolveApiBase(site: string): URL | undefined {
  if (!(DATADOG_TRIAGE_ALLOWED_SITES as readonly string[]).includes(site)) {
    return undefined
  }
  try {
    const url = new URL(datadogApiBaseUrl(site))
    if (
      url.protocol !== "https:" ||
      url.hostname !== `api.${site}` ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

function rateLimitFrom(response: Response): DatadogRateLimit | undefined {
  const limit = asNumber(response.headers.get("x-ratelimit-limit"))
  const remaining = asNumber(response.headers.get("x-ratelimit-remaining"))
  const resetSeconds = asNumber(response.headers.get("x-ratelimit-reset"))
  if (
    limit === undefined &&
    remaining === undefined &&
    resetSeconds === undefined
  ) {
    return undefined
  }
  return { limit, remaining, resetSeconds }
}

function retryAfterSecondsFrom(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")
  if (raw === null) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function failureForStatus(response: Response): DatadogFailure {
  const status = response.status
  const rateLimit = rateLimitFrom(response)
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      ambiguous: false,
      status,
      rateLimit,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      ambiguous: false,
      status,
      retryAfterSeconds: retryAfterSecondsFrom(response),
      rateLimit,
    }
  }
  return {
    ok: false,
    reason: status >= 500 ? "network_error" : "rejected",
    retryable: status >= 500,
    ambiguous: false,
    status,
    rateLimit,
  }
}

function failureForThrow(error: unknown): DatadogFailure {
  // Classify on the typed surface, never the message. `AbortSignal.timeout`
  // rejects with TimeoutError; a manual abort gives AbortError.
  const name = (error as { name?: string } | null | undefined)?.name
  return {
    ok: false,
    reason:
      name === "TimeoutError" || name === "AbortError"
        ? "timeout"
        : "network_error",
    retryable: true,
    ambiguous: false,
  }
}

/** `meta.status: "timeout"` arrives with HTTP 200 and partial numbers. */
function isPartialMeta(meta: unknown): boolean {
  const status = (meta as { status?: unknown } | null | undefined)?.status
  return asString(status) === "timeout"
}

export class DatadogTriageClient {
  private readonly apiBase: URL | undefined

  constructor(
    private readonly config: DatadogClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBase = resolveApiBase(config.site)
  }

  /**
   * One page of Error Tracking issues for a service and window. `state` is
   * returned per issue, which is what makes R18's Datadog-side mute lever work
   * without this pipeline ever writing to Datadog.
   */
  async searchIssues(input: {
    service: string
    from: Date
    to: Date
    limit?: number
    maxPages?: number
  }): Promise<DatadogResult<DatadogIssuePage>> {
    const limit = Math.min(
      input.limit ?? DATADOG_ISSUE_PAGE_LIMIT,
      DATADOG_ISSUE_PAGE_LIMIT,
    )
    const maxPages = Math.max(1, input.maxPages ?? DATADOG_ISSUE_MAX_PAGES)

    // Deduplicated across pages by issue id: the window already re-reads its
    // overlap, and a shifting result set can repeat a row across a cursor.
    const byId = new Map<string, DatadogIssue>()
    let unparsedRows = 0
    let cursor: string | undefined
    let truncated = false
    let rateLimit: DatadogResult<DatadogIssuePage>["rateLimit"]

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.fetchIssuePage({
        service: input.service,
        from: input.from,
        to: input.to,
        limit,
        cursor,
      })
      // A mid-pagination failure fails the whole read. Returning the pages
      // gathered so far would look like a complete short window and seed a
      // baseline missing everything behind the failure.
      if (!result.ok) return result
      rateLimit = result.rateLimit

      for (const issue of result.value.issues) byId.set(issue.issueId, issue)
      unparsedRows += result.value.unparsedRows

      cursor = result.value.nextCursor
      const full = result.value.rowCount >= limit
      if (!full) break
      if (!cursor) {
        // Full page, no cursor to follow: the envelope does not expose one at
        // either spelling, so this read is incomplete and must say so.
        truncated = true
        break
      }
      if (page === maxPages - 1) truncated = true
    }

    return {
      ok: true,
      value: { issues: [...byId.values()], unparsedRows, truncated },
      rateLimit,
    }
  }

  private async fetchIssuePage(input: {
    service: string
    from: Date
    to: Date
    limit: number
    cursor?: string
  }): Promise<
    DatadogResult<{
      issues: DatadogIssue[]
      unparsedRows: number
      rowCount: number
      nextCursor?: string
    }>
  > {
    const result = await this.request(
      "api/v2/error-tracking/issues/search",
      {
        method: "POST",
        body: {
          data: {
            type: "search_request",
            attributes: {
              query: `service:${input.service}`,
              from: input.from.getTime(),
              to: input.to.getTime(),
              page: input.cursor
                ? { limit: input.limit, cursor: input.cursor }
                : { limit: input.limit },
            },
          },
        },
      },
      issueSearchEnvelopeSchema,
    )
    if (!result.ok) return result

    const detailById = new Map<string, z.infer<typeof issueRowSchema>>()
    for (const row of result.value.included ?? []) {
      const id = asString(row.id)
      if (id) detailById.set(id, row)
    }

    const issues: DatadogIssue[] = []
    let unparsedRows = 0
    for (const row of result.value.data) {
      const merged = {
        ...(detailById.get(asString(row.id) ?? "")?.attributes ?? {}),
        ...(row.attributes ?? {}),
        ...row,
      }
      const issueId = asString(merged.issue_id) ?? asString(row.id)
      // The windowed count is as load-bearing as the id: detection's
      // recurrence floor and every rate comparison read it, so a renamed count
      // field would baseline everything at zero and go permanently quiet.
      const totalCount = asNumber(merged.total_count)
      if (!issueId || totalCount === undefined) {
        unparsedRows += 1
        continue
      }
      issues.push({
        issueId,
        service: asString(merged.service),
        state: asString(merged.state),
        errorType: asString(merged.error_type),
        errorMessage: asString(merged.error_message),
        filePath: asString(merged.file_path),
        functionName: asString(merged.function_name),
        platform: asString(merged.platform),
        isCrash:
          typeof merged.is_crash === "boolean" ? merged.is_crash : undefined,
        firstSeen: asIsoTimestamp(merged.first_seen),
        lastSeen: asIsoTimestamp(merged.last_seen),
        firstSeenVersion: asString(merged.first_seen_version),
        lastSeenVersion: asString(merged.last_seen_version),
        totalCount,
      })
    }
    return {
      ok: true,
      value: {
        issues,
        unparsedRows,
        // Raw row count, not the parsed count: an unparsed row still occupies
        // a slot, so fullness must be measured before any row is dropped.
        rowCount: result.value.data.length,
        nextCursor: nextIssueCursor(result.value),
      },
      rateLimit: result.rateLimit,
    }
  }

  /**
   * Monitors scoped to one service by tag (KTD6) — never the org's full
   * monitor list, which would pull in every other team's alerting.
   */
  async listMonitors(input: {
    monitorTag: string
  }): Promise<DatadogResult<DatadogMonitorPage>> {
    const result = await this.request(
      "api/v1/monitor",
      {
        method: "GET",
        query: {
          monitor_tags: input.monitorTag,
          group_states: "alert,warn",
          page_size: String(DATADOG_MONITOR_PAGE_LIMIT),
        },
      },
      z.array(monitorRowSchema),
    )
    if (!result.ok) return result

    const monitors: DatadogMonitor[] = []
    let unparsedRows = 0
    for (const row of result.value) {
      const monitorId = asString(row.id) ?? asNumber(row.id)?.toString()
      if (!monitorId) {
        unparsedRows += 1
        continue
      }
      monitors.push({
        monitorId,
        name: asString(row.name),
        overallState: asString(row.overall_state),
        overallStateModified: asIsoTimestamp(row.overall_state_modified),
        tags: Array.isArray(row.tags)
          ? row.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
      })
    }
    return {
      ok: true,
      value: { monitors, unparsedRows },
      rateLimit: result.rateLimit,
    }
  }

  async aggregateLogs(input: {
    query: string
    from: Date
    to: Date
    groupBy?: string
  }): Promise<DatadogResult<DatadogAggregate>> {
    return this.aggregate("api/v2/logs/analytics/aggregate", input)
  }

  async aggregateRumEvents(input: {
    query: string
    from: Date
    to: Date
    groupBy?: string
  }): Promise<DatadogResult<DatadogAggregate>> {
    return this.aggregate("api/v2/rum/analytics/aggregate", input)
  }

  private async aggregate(
    path: string,
    input: { query: string; from: Date; to: Date; groupBy?: string },
  ): Promise<DatadogResult<DatadogAggregate>> {
    const result = await this.request(
      path,
      {
        method: "POST",
        body: {
          compute: [{ aggregation: "count", type: "total" }],
          filter: {
            query: input.query,
            from: input.from.toISOString(),
            to: input.to.toISOString(),
          },
          ...(input.groupBy
            ? { group_by: [{ facet: input.groupBy, limit: 50 }] }
            : {}),
        },
      },
      aggregateEnvelopeSchema,
    )
    if (!result.ok) return result

    const buckets: DatadogAggregateBucket[] = []
    for (const bucket of result.value.data.buckets) {
      const byValues = Object.values(bucket.by ?? {})
        .map((value) => asString(value))
        .filter((value): value is string => value !== undefined)
      const computes = Object.values(bucket.computes ?? {})
        .map((value) => asNumber(value))
        .filter((value): value is number => value !== undefined)
      buckets.push({
        key: byValues.join("|") || "total",
        count: computes[0] ?? 0,
      })
    }
    return {
      ok: true,
      value: { buckets, partial: isPartialMeta(result.value.meta) },
      rateLimit: result.rateLimit,
    }
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST"
      body?: unknown
      query?: Record<string, string>
    },
    schema: z.ZodType<T>,
  ): Promise<DatadogResult<T>> {
    if (!this.apiBase) {
      return {
        ok: false,
        reason: "invalid_config",
        retryable: false,
        ambiguous: false,
      }
    }
    if (!this.config.apiKey || !this.config.applicationKey) {
      return {
        ok: false,
        reason: "config_missing",
        retryable: false,
        ambiguous: false,
      }
    }

    const url = new URL(path, `${this.apiBase.origin}/`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers: {
          "dd-api-key": this.config.apiKey,
          "dd-application-key": this.config.applicationKey,
          accept: "application/json",
          "user-agent": "forge-mastra-datadog-triage/1.0",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        // No legitimate redirect exists; following one would re-send both
        // Datadog credentials to an unvetted host.
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      return failureForThrow(error)
    }

    if (!response.ok) {
      await discardResponseBody(response)
      return failureForStatus(response)
    }

    const rateLimit = rateLimitFrom(response)
    let body: unknown
    try {
      body = await readJsonBodyCappedOrThrow(
        response,
        this.config.maxResponseBytes,
      )
    } catch (error) {
      // A mid-body timeout is a latency incident, not a parse failure.
      return { ...failureForThrow(error), rateLimit }
    }
    if (body === BOUNDED_READ_OVER_CAP) {
      // Distinct from `parse_error`: the shape did not drift, the body was too
      // big. The runbook routes those two to different operator actions, and
      // the Linear sibling already separates them.
      return {
        ok: false,
        reason: "response_too_large",
        retryable: true,
        ambiguous: false,
        status: response.status,
        rateLimit,
      }
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return {
        ok: false,
        reason: "parse_error",
        retryable: false,
        ambiguous: false,
        status: response.status,
        rateLimit,
      }
    }
    return { ok: true, value: parsed.data, rateLimit }
  }
}
