import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../config/seo"
import {
  getGoogleAccessToken,
  isGoogleApiDate,
  requestGoogleJson,
  type GoogleTokenProvider,
} from "./google-auth-client"
import { minimizeSeoUrl } from "./seo-data-minimization"
import type { SeoEvidenceObservation, SeoProviderFailure } from "./seo-evidence"
import { boundedSeoProviderPageSize } from "./seo-http"
import { WATCH_NOT_FOUND_METADATA_TITLES } from "@forge/watch-url-policy/not-found-titles"

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const GA4_IN_LIST_FILTER_CHUNK_SIZE = 50
const ALLOWED_DIMENSIONS = new Set(["date", "landingPagePlusQueryString"])
const ALLOWED_METRICS = new Set([
  "sessions",
  "engagedSessions",
  "engagementRate",
  "keyEvents",
  "screenPageViews",
])

function landingPagePath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.pathname
  } catch {
    return null
  }
}

const ValueSchema = z.object({ value: z.string() }).passthrough()
const ResponseSchema = z
  .object({
    dimensionHeaders: z
      .array(z.object({ name: z.string() }).passthrough())
      .default([]),
    metricHeaders: z
      .array(z.object({ name: z.string() }).passthrough())
      .default([]),
    rows: z
      .array(
        z
          .object({
            dimensionValues: z.array(ValueSchema).default([]),
            metricValues: z.array(ValueSchema).default([]),
          })
          .passthrough(),
      )
      .default([]),
    rowCount: z.number().int().nonnegative().optional(),
    metadata: z
      .object({
        dataLossFromOtherRow: z.boolean().optional(),
        currencyCode: z.string().optional(),
        timeZone: z.string().optional(),
        subjectToThresholding: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    propertyQuota: z.unknown().optional(),
  })
  .passthrough()

export type Ga4Row = {
  dimensions: Record<string, string>
  metrics: Record<string, number>
}
export type Ga4QueryResult =
  | {
      ok: true
      propertyId: string
      rows: Ga4Row[]
      observation: SeoEvidenceObservation
      propertyTimezone: string | null
    }
  | SeoProviderFailure

export type WatchRouteNotFoundLane = "explicit_event" | "localized_title"
export type Ga4RequestBudget = { remaining: number }
export type WatchRouteNotFoundResult =
  | {
      ok: true
      propertyId: string
      lane: WatchRouteNotFoundLane
      rows: Ga4Row[]
      complete: boolean
      caveats: string[]
      propertyTimezone: string | null
    }
  | SeoProviderFailure

function number(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function runGa4Report({
  propertyId,
  startDate,
  endDate,
  dimensions,
  metrics,
  dimensionFilter,
  accessToken,
  config,
  fetchImpl,
  sleep,
  maxRows = config.maxGa4Rows,
  requestBudget = { remaining: 25 },
}: {
  propertyId: string
  startDate: string
  endDate: string
  dimensions: string[]
  metrics: string[]
  dimensionFilter?: unknown
  accessToken: string
  config: SeoConfig
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRows?: number
  requestBudget?: Ga4RequestBudget
}): Promise<
  | {
      ok: true
      rows: Ga4Row[]
      metadata: z.infer<typeof ResponseSchema>["metadata"]
      propertyQuota: unknown
      declaredRowCount: number
      capped: boolean
      requestBudgetExhausted: boolean
    }
  | SeoProviderFailure
> {
  const rows: Ga4Row[] = []
  let pageSize = boundedSeoProviderPageSize({
    maxRows,
    maxResponseBytes: config.maxResponseBytes,
    providerMaxRows: 10_000,
  })
  let metadata: z.infer<typeof ResponseSchema>["metadata"]
  let propertyQuota: unknown
  let declaredRowCount: number | null = null
  let requestBudgetExhausted = false
  while (rows.length < maxRows) {
    if (requestBudget.remaining <= 0) {
      requestBudgetExhausted = true
      break
    }
    requestBudget.remaining -= 1
    const requestedPageSize = Math.min(pageSize, maxRows - rows.length)
    const response = await requestGoogleJson({
      url: new URL(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      ),
      accessToken,
      body: {
        dateRanges: [{ startDate, endDate }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        ...(dimensionFilter ? { dimensionFilter } : {}),
        limit: String(requestedPageSize),
        offset: String(rows.length),
        returnPropertyQuota: true,
      },
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      maxAttempts: config.maxProviderAttempts,
      fetchImpl,
      sleep,
    })
    if (!response.ok) {
      if (response.reason === "response_too_large" && requestedPageSize > 1) {
        pageSize = Math.max(1, Math.floor(requestedPageSize / 2))
        continue
      }
      return response.reason === "response_too_large"
        ? { ok: false, reason: "parse_error", retryable: true }
        : response
    }
    const parsed = ResponseSchema.safeParse(response.body)
    if (!parsed.success || parsed.data.rows.length > requestedPageSize) {
      return { ok: false, reason: "parse_error", retryable: true }
    }
    const responseRowCount = parsed.data.rowCount
    if (responseRowCount == null) {
      if (parsed.data.rows.length > 0 || declaredRowCount != null) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
    } else {
      if (
        (declaredRowCount != null && responseRowCount !== declaredRowCount) ||
        responseRowCount < rows.length + parsed.data.rows.length
      ) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      declaredRowCount = responseRowCount
    }
    metadata = parsed.data.metadata ?? metadata
    propertyQuota = parsed.data.propertyQuota ?? propertyQuota
    if (parsed.data.rows.length === 0) {
      if (
        declaredRowCount != null &&
        rows.length < Math.min(declaredRowCount, maxRows)
      ) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      break
    }
    for (const row of parsed.data.rows) {
      if (
        row.dimensionValues.length !== dimensions.length ||
        row.metricValues.length !== metrics.length
      ) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      const projectedMetrics: Record<string, number> = {}
      for (const [index, name] of metrics.entries()) {
        const parsedNumber = number(row.metricValues[index]!.value)
        if (parsedNumber == null) {
          return { ok: false, reason: "parse_error", retryable: true }
        }
        projectedMetrics[name] = parsedNumber
      }
      rows.push({
        dimensions: Object.fromEntries(
          dimensions.map((name, index) => [
            name,
            row.dimensionValues[index]!.value,
          ]),
        ),
        metrics: projectedMetrics,
      })
    }
    if (parsed.data.rows.length < requestedPageSize) {
      if (
        declaredRowCount != null &&
        rows.length < Math.min(declaredRowCount, maxRows)
      ) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      break
    }
  }
  const totalRows = declaredRowCount ?? rows.length
  return {
    ok: true,
    rows,
    metadata,
    propertyQuota,
    declaredRowCount: totalRows,
    capped:
      requestBudgetExhausted ||
      (rows.length >= maxRows && totalRows > rows.length),
    requestBudgetExhausted,
  }
}

export async function queryWatchRouteNotFoundLane(input: {
  propertyId: string
  lane: WatchRouteNotFoundLane
  startDate: string
  endDate: string
  config?: SeoConfig
  tokenProvider?: GoogleTokenProvider
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  requestBudget?: Ga4RequestBudget
}): Promise<WatchRouteNotFoundResult> {
  const config = input.config ?? getSeoConfig()
  if (!config.ga4PropertyIds.includes(input.propertyId)) {
    return { ok: false, reason: "not_allowed", retryable: false }
  }
  if (
    !isGoogleApiDate(input.startDate) ||
    !isGoogleApiDate(input.endDate) ||
    input.startDate > input.endDate
  ) {
    return { ok: false, reason: "rejected", retryable: false }
  }
  const token = await (
    input.tokenProvider ?? ((scopes) => getGoogleAccessToken(scopes))
  )([GA4_SCOPE])
  if (!token.ok) return token

  const dimensions =
    input.lane === "explicit_event"
      ? ["date", "pagePathPlusQueryString"]
      : ["date", "pagePathPlusQueryString", "pageTitle"]
  const metrics =
    input.lane === "explicit_event"
      ? ["eventCount", "activeUsers"]
      : ["screenPageViews", "activeUsers"]
  const pathFilter = {
    filter: {
      fieldName: "pagePathPlusQueryString",
      stringFilter: {
        matchType: "BEGINS_WITH",
        value: "/watch/",
        caseSensitive: true,
      },
    },
  }
  const titleChunks =
    input.lane === "localized_title"
      ? Array.from(
          {
            length: Math.ceil(
              WATCH_NOT_FOUND_METADATA_TITLES.length /
                GA4_IN_LIST_FILTER_CHUNK_SIZE,
            ),
          },
          (_, index) =>
            WATCH_NOT_FOUND_METADATA_TITLES.slice(
              index * GA4_IN_LIST_FILTER_CHUNK_SIZE,
              (index + 1) * GA4_IN_LIST_FILTER_CHUNK_SIZE,
            ),
        )
      : [null]
  const reports: Array<
    Extract<Awaited<ReturnType<typeof runGa4Report>>, { ok: true }>
  > = []
  const failures: SeoProviderFailure[] = []
  let aggregateCapReached = false
  for (const titles of titleChunks) {
    const collectedRows = reports.reduce(
      (total, report) => total + report.rows.length,
      0,
    )
    if (collectedRows >= config.maxGa4Rows) {
      aggregateCapReached = true
      break
    }
    const laneFilter = titles
      ? {
          filter: {
            fieldName: "pageTitle",
            inListFilter: { values: titles, caseSensitive: true },
          },
        }
      : {
          filter: {
            fieldName: "eventName",
            stringFilter: {
              matchType: "EXACT",
              value: "page_not_found",
              caseSensitive: true,
            },
          },
        }
    const report = await runGa4Report({
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions,
      metrics,
      dimensionFilter: {
        andGroup: { expressions: [pathFilter, laneFilter] },
      },
      accessToken: token.accessToken,
      config,
      fetchImpl: input.fetchImpl,
      sleep: input.sleep,
      maxRows: config.maxGa4Rows - collectedRows,
      requestBudget: input.requestBudget,
    })
    if (report.ok) reports.push(report)
    else failures.push(report)
  }
  if (reports.length === 0 && failures[0]) return failures[0]
  const thresholded = reports.some(
    (report) => report.metadata?.subjectToThresholding === true,
  )
  const dataLoss = reports.some(
    (report) => report.metadata?.dataLossFromOtherRow === true,
  )
  const capped = aggregateCapReached || reports.some((report) => report.capped)
  const requestBudgetExhausted = reports.some(
    (report) => report.requestBudgetExhausted,
  )
  const timezones = new Set(
    reports.flatMap((report) => report.metadata?.timeZone ?? []),
  )
  const caveats = [
    ...(thresholded ? ["GA4 reported thresholding for this lane."] : []),
    ...(dataLoss
      ? ["GA4 reported data loss from an aggregated other row."]
      : []),
    ...(capped ? ["Configured GA4 row cap was reached."] : []),
    ...(requestBudgetExhausted
      ? ["The bounded GA4 request budget was exhausted."]
      : []),
    ...(failures.length
      ? [`${failures.length} GA4 title-filter chunk(s) failed.`]
      : []),
    ...(timezones.size > 1
      ? ["GA4 returned inconsistent property timezones across chunks."]
      : []),
  ]
  return {
    ok: true,
    propertyId: input.propertyId,
    lane: input.lane,
    rows: reports.flatMap((report) => report.rows),
    complete:
      !thresholded &&
      !dataLoss &&
      !capped &&
      failures.length === 0 &&
      reports.length === titleChunks.length &&
      timezones.size <= 1,
    caveats,
    propertyTimezone: timezones.values().next().value ?? null,
  }
}

/**
 * Watch GA4 wire names the FGE-115 reconciliation readout may count. Mirrors
 * `WATCH_ANALYTICS_WIRE_NAMES` in `apps/web/src/lib/watch-analytics-contract.ts`
 * (Mastra cannot import Web). An event name outside this list is rejected
 * rather than queried, so the readout cannot become a general event browser.
 */
export const WATCH_MEASUREMENT_EVENT_NAMES = [
  "page_view",
  "videostarts",
  "videoplay",
  "video_pause",
  "a_media_progress10",
  "a_media_progress25",
  "a_media_progress50",
  "a_media_progress75",
  "a_media_progress90",
  "video_progress",
  "videocomplete",
  "search_completed",
  "search_result_clicked",
  "language_picker_opened",
  "language_applied",
  "subtitle_applied",
  "download_intent",
  "download_started",
  "share_opened",
  "share_completed",
  "watch_cta_clicked",
] as const
export type WatchMeasurementEventName =
  (typeof WATCH_MEASUREMENT_EVENT_NAMES)[number]

/**
 * Reporting grain for the reconciliation readout.
 *
 * - `standard` — `date`, `eventName`, `pagePath`. Needs no custom definition,
 *   so it answers the v1 baseline and the migration boundary.
 * - `contract` — adds the registered event-scoped custom dimensions for the
 *   low-cardinality v2 route variant and contract version (R20). GA4 rejects
 *   the query until both are registered, and registration is not retroactive:
 *   rows before registration read `(not set)`.
 *
 * `pagePath` is query-free by definition; raw paths, slugs, and IDs (R21)
 * are never requested here.
 */
export type WatchMeasurementGrain = "standard" | "contract"

const WATCH_MEASUREMENT_ROUTE_VARIANT_DIMENSION =
  "customEvent:watch_route_variant"
const WATCH_MEASUREMENT_CONTRACT_VERSION_DIMENSION =
  "customEvent:event_contract_version"
const WATCH_MEASUREMENT_MAX_PAGE_PATHS = 20
const WATCH_MEASUREMENT_PAGE_PATH = /^\/watch\/[A-Za-z0-9._~/-]{1,200}$/
const GA4_NOT_SET = "(not set)"

export type WatchMeasurementReconciliation = {
  pagePath: string
  eventName: string
  /** Sum of every row for this page path and event, across dates and variants. */
  total: number
  /** Per route variant (`contract` grain only); `(not set)` stays visible. */
  byRouteVariant: Record<string, number>
  /** Share of `total` without a route variant — v1 rows, or pre-registration. */
  unattributedShare: number | null
}

export type WatchMeasurementResult =
  | {
      ok: true
      propertyId: string
      grain: WatchMeasurementGrain
      rows: Ga4Row[]
      reconciliation: WatchMeasurementReconciliation[]
      /** False whenever a caveat means totals cannot support a definitive conclusion. */
      complete: boolean
      caveats: string[]
      propertyTimezone: string | null
      propertyQuota: unknown
    }
  | SeoProviderFailure

/**
 * Fold report rows into one total per (page path, event name), keeping the
 * per-route-variant breakdown (AE7). Pure, so the readout's arithmetic is
 * testable without a provider. Canonical grouping already happened at
 * collection time — v2 sends the canonical `page_path` — so canonical and
 * compatibility traffic for one identity share a key here and differ only in
 * `byRouteVariant`.
 */
export function reconcileWatchMeasurementRows(
  rows: Ga4Row[],
): WatchMeasurementReconciliation[] {
  const groups = new Map<string, WatchMeasurementReconciliation>()
  for (const row of rows) {
    const pagePath = row.dimensions.pagePath ?? GA4_NOT_SET
    const eventName = row.dimensions.eventName ?? GA4_NOT_SET
    const count = row.metrics.eventCount ?? 0
    const key = JSON.stringify([pagePath, eventName])
    const group = groups.get(key) ?? {
      pagePath,
      eventName,
      total: 0,
      byRouteVariant: {},
      unattributedShare: null,
    }
    group.total += count
    const variant = row.dimensions[WATCH_MEASUREMENT_ROUTE_VARIANT_DIMENSION]
    if (variant != null) {
      group.byRouteVariant[variant] =
        (group.byRouteVariant[variant] ?? 0) + count
    }
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      unattributedShare:
        Object.keys(group.byRouteVariant).length === 0 || group.total === 0
          ? null
          : (group.byRouteVariant[GA4_NOT_SET] ?? 0) / group.total,
    }))
    .sort(
      (a, b) =>
        a.pagePath.localeCompare(b.pagePath) ||
        a.eventName.localeCompare(b.eventName),
    )
}

/**
 * Read-only FGE-115 reconciliation readout: Watch event counts by date, event
 * name, and canonical page path, optionally split by route variant and
 * contract version (U6, R26, KTD8).
 *
 * Bounded on every axis: allowlisted property, allowlisted event names, at
 * most 20 exact `/watch/` page paths (or the whole `/watch/` prefix), the
 * shared row cap, and the shared request budget. Thresholding, other-row data
 * loss, capped rows, an exhausted budget, and inconsistent timezones each add
 * a caveat and mark the result incomplete, so a partial result can never read
 * as a definitive behavioral conclusion.
 */
export async function queryWatchMeasurementReconciliation(input: {
  propertyId: string
  startDate: string
  endDate: string
  grain?: WatchMeasurementGrain
  eventNames?: readonly string[]
  pagePaths?: readonly string[]
  config?: SeoConfig
  tokenProvider?: GoogleTokenProvider
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  requestBudget?: Ga4RequestBudget
}): Promise<WatchMeasurementResult> {
  const config = input.config ?? getSeoConfig()
  if (!config.ga4PropertyIds.includes(input.propertyId)) {
    return { ok: false, reason: "not_allowed", retryable: false }
  }
  const grain = input.grain ?? "standard"
  const eventNames = [...new Set(input.eventNames ?? ["page_view"])]
  const pagePaths = [...new Set(input.pagePaths ?? [])]
  if (
    !isGoogleApiDate(input.startDate) ||
    !isGoogleApiDate(input.endDate) ||
    input.startDate > input.endDate ||
    (grain !== "standard" && grain !== "contract") ||
    eventNames.length === 0 ||
    eventNames.some(
      (name) =>
        !(WATCH_MEASUREMENT_EVENT_NAMES as readonly string[]).includes(name),
    ) ||
    pagePaths.length > WATCH_MEASUREMENT_MAX_PAGE_PATHS ||
    pagePaths.some(
      (path) =>
        !WATCH_MEASUREMENT_PAGE_PATH.test(path) ||
        path.includes("//") ||
        path.split("/").includes(".."),
    )
  ) {
    return { ok: false, reason: "rejected", retryable: false }
  }
  const token = await (
    input.tokenProvider ?? ((scopes) => getGoogleAccessToken(scopes))
  )([GA4_SCOPE])
  if (!token.ok) return token

  const dimensions = [
    "date",
    "eventName",
    "pagePath",
    ...(grain === "contract"
      ? [
          WATCH_MEASUREMENT_ROUTE_VARIANT_DIMENSION,
          WATCH_MEASUREMENT_CONTRACT_VERSION_DIMENSION,
        ]
      : []),
  ]
  const pathFilter =
    pagePaths.length > 0
      ? {
          filter: {
            fieldName: "pagePath",
            inListFilter: { values: pagePaths, caseSensitive: true },
          },
        }
      : {
          filter: {
            fieldName: "pagePath",
            stringFilter: {
              matchType: "BEGINS_WITH",
              value: "/watch/",
              caseSensitive: true,
            },
          },
        }
  const report = await runGa4Report({
    propertyId: input.propertyId,
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions,
    metrics: ["eventCount"],
    dimensionFilter: {
      andGroup: {
        expressions: [
          pathFilter,
          {
            filter: {
              fieldName: "eventName",
              inListFilter: { values: eventNames, caseSensitive: true },
            },
          },
        ],
      },
    },
    accessToken: token.accessToken,
    config,
    fetchImpl: input.fetchImpl,
    sleep: input.sleep,
    requestBudget: input.requestBudget,
  })
  if (!report.ok) return report

  // A row outside the requested scope means the provider did not apply the
  // filter as sent; counting it would silently widen the readout.
  const outOfScope = report.rows.some((row) => {
    const pagePath = row.dimensions.pagePath ?? ""
    const eventName = row.dimensions.eventName ?? ""
    return (
      !eventNames.includes(eventName) ||
      (pagePaths.length > 0
        ? !pagePaths.includes(pagePath)
        : !pagePath.startsWith("/watch/"))
    )
  })
  if (outOfScope) return { ok: false, reason: "parse_error", retryable: true }

  const thresholded = report.metadata?.subjectToThresholding === true
  const dataLoss = report.metadata?.dataLossFromOtherRow === true
  const reconciliation = reconcileWatchMeasurementRows(report.rows)
  const unattributed =
    grain === "contract" &&
    reconciliation.some((group) => (group.unattributedShare ?? 0) > 0)
  const caveats = [
    ...(thresholded
      ? ["GA4 reports this result as subject to thresholding."]
      : []),
    ...(dataLoss
      ? ["GA4 reports data loss from an aggregated other row."]
      : []),
    ...(report.capped ? ["Configured GA4 row cap was reached."] : []),
    ...(report.requestBudgetExhausted
      ? ["The bounded GA4 request budget was exhausted."]
      : []),
    ...(unattributed
      ? [
          "Some events carry no route variant: v1 traffic, or rows collected before the custom dimension was registered.",
        ]
      : []),
    "Totals are GA4 aggregates after the property's filters; reconcile thresholded, filtered, and bot/internal traffic before comparing route variants.",
  ]
  return {
    ok: true,
    propertyId: input.propertyId,
    grain,
    rows: report.rows,
    reconciliation,
    complete: !thresholded && !dataLoss && !report.capped,
    caveats,
    propertyTimezone: report.metadata?.timeZone ?? null,
    propertyQuota: report.propertyQuota ?? null,
  }
}

export async function queryGoogleAnalytics(input: {
  propertyId: string
  startDate: string
  endDate: string
  dimensions?: string[]
  metrics?: string[]
  landingPage?: string
  config?: SeoConfig
  tokenProvider?: GoogleTokenProvider
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  observationId?: string
}): Promise<Ga4QueryResult> {
  const config = input.config ?? getSeoConfig()
  if (!config.ga4PropertyIds.includes(input.propertyId)) {
    return { ok: false, reason: "not_allowed", retryable: false }
  }
  const dimensions = input.dimensions ?? ["date", "landingPagePlusQueryString"]
  const metrics = input.metrics ?? ["sessions", "engagedSessions", "keyEvents"]
  const exactLandingPage = input.landingPage
    ? landingPagePath(input.landingPage)
    : null
  if (
    !isGoogleApiDate(input.startDate) ||
    !isGoogleApiDate(input.endDate) ||
    input.startDate > input.endDate ||
    dimensions.some((item) => !ALLOWED_DIMENSIONS.has(item)) ||
    metrics.some((item) => !ALLOWED_METRICS.has(item)) ||
    (input.landingPage != null && !exactLandingPage)
  ) {
    return { ok: false, reason: "rejected", retryable: false }
  }
  const token = await (
    input.tokenProvider ?? ((scopes) => getGoogleAccessToken(scopes))
  )([GA4_SCOPE])
  if (!token.ok) return token

  const report = await runGa4Report({
    propertyId: input.propertyId,
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions,
    metrics,
    dimensionFilter: exactLandingPage
      ? {
          filter: {
            fieldName: "landingPagePlusQueryString",
            stringFilter: {
              matchType: "EXACT",
              value: exactLandingPage,
              caseSensitive: true,
            },
          },
        }
      : undefined,
    accessToken: token.accessToken,
    config,
    fetchImpl: input.fetchImpl,
    sleep: input.sleep,
  })
  if (!report.ok) return report
  const rows = report.rows.map((row) => ({
    ...row,
    dimensions: Object.fromEntries(
      Object.entries(row.dimensions).map(([name, value]) => {
        if (name !== "landingPagePlusQueryString") return [name, value]
        const minimized = minimizeSeoUrl(`https://placeholder.invalid${value}`)
        return [
          name,
          minimized
            ? new URL(minimized).pathname
            : (value.split("?")[0] ?? "/"),
        ]
      }),
    ),
  }))
  const thresholded = report.metadata?.subjectToThresholding === true
  const dataLoss = report.metadata?.dataLossFromOtherRow === true
  const caveats = [
    ...(thresholded
      ? ["GA4 reports this result as subject to thresholding."]
      : []),
    ...(dataLoss
      ? ["GA4 reports data loss from an aggregated other row."]
      : []),
    ...(report.capped ? ["Configured GA4 row cap was reached."] : []),
    "GA4 landing-page/date aggregates are guardrails and are not joined to individual Search Console queries or users.",
  ]
  const observation: SeoEvidenceObservation = {
    id:
      input.observationId ??
      `ga4-${createHash("sha256").update(`${input.propertyId}:${input.startDate}:${input.endDate}:${randomUUID()}`).digest("hex").slice(0, 20)}`,
    provider: "ga4",
    status: thresholded || dataLoss || report.capped ? "partial" : "available",
    retrievedAt: (input.now ?? (() => new Date()))().toISOString(),
    scope: {
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    data: {
      dimensions,
      metrics,
      rowCount: rows.length,
      declaredRowCount: report.declaredRowCount,
      rows,
      propertyTimezone: report.metadata?.timeZone ?? null,
      currencyCode: report.metadata?.currencyCode ?? null,
      propertyQuota: report.propertyQuota ?? null,
    },
    quality: {
      complete: !thresholded && !dataLoss && !report.capped,
      truncated: report.capped,
      caveats,
    },
    sources: [],
  }
  return {
    ok: true,
    propertyId: input.propertyId,
    rows,
    observation,
    propertyTimezone: report.metadata?.timeZone ?? null,
  }
}
