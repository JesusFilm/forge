import { createHash } from "node:crypto"

import { GoogleAuth, Impersonated } from "google-auth-library"
import { z } from "zod"

import { requestGoogleJson } from "../google-auth-client"
import { GA_WATCH_PROPERTY } from "./ga-watch-history-range"
import { HistoricalAnalyticsError } from "./historical-analytics"
import type {
  HistoricalAnalyticsReader,
  HistoricalSnapshot,
} from "./historical-analytics"
import {
  createWatchRouteMapper,
  type WatchRouteCatalogVideo,
} from "./watch-route-identity"

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const WATCH_HOSTS = ["jesusfilm.org", "www.jesusfilm.org"] as const
const WATCH_PATH_REGEX = "^/watch(/.*)?$"
const WATCH_REFERRER_REGEX =
  "^https?://(www\\.)?jesusfilm\\.org/watch(/[^?#]*)?([?#].*)?$"
const REPORT_PAGE_SIZE = 1_000
const SNAPSHOT_PAGE_SIZE = 500
const COVERAGE_REPORT_TIMEOUT_MS = 50_000
const DETAILED_REPORT_TIMEOUT_MS = 120_000
const MAX_REPORT_PAGES = 25
const EVENT_NAMES = [
  "page_view",
  "videostarts",
  "videoplay",
  "video_progress",
  "videocomplete",
] as const

const valueSchema = z.object({ value: z.string() }).passthrough()
const reportSchema = z
  .object({
    dimensionHeaders: z.array(z.object({ name: z.string() }).passthrough()),
    metricHeaders: z.array(z.object({ name: z.string() }).passthrough()),
    rowCount: z.number().int().nonnegative().safe().optional(),
    rows: z
      .array(
        z.object({
          dimensionValues: z.array(valueSchema),
          metricValues: z.array(valueSchema),
        }),
      )
      .default([]),
    metadata: z
      .object({
        timeZone: z.string().min(1),
        currencyCode: z.string().optional(),
        emptyReason: z.string().optional(),
        subjectToThresholding: z.boolean().optional(),
        dataLossFromOtherRow: z.boolean().optional(),
        samplingMetadatas: z.array(z.unknown()).optional(),
        schemaRestrictionResponse: z.unknown().optional(),
        dataTruncationReasons: z
          .array(
            z
              .object({
                dataTruncationType: z.string(),
                dataTruncationMessage: z.string().optional(),
                dataTruncationDate: z.iso.date().optional(),
                dataTruncationDateRanges: z
                  .array(
                    z.object({
                      startDate: z.iso.date(),
                      endDate: z.iso.date(),
                    }),
                  )
                  .optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .passthrough()

type Report = z.output<typeof reportSchema> & {
  rowCount: number
}
type ReportRow = { dimensions: string[]; count: number }
type ReportResult = {
  rows: ReportRow[]
  rowCount: number
  pageCount: number
  transportAttempts: number
  timeZone: string
  thresholded: boolean
  otherRow: boolean
  sampled: boolean
  restricted: boolean
  truncated: boolean
  sourceAvailableAfter: string | null
  truncatedDateRanges: { startDate: string; endDate: string }[]
  truncationTypes: string[]
}

export type GaWatchCoverage = {
  provider: "ga_data_api"
  propertyId: string
  status: "blocked" | "incomplete"
  reason:
    | "missing_session_identity"
    | "source_truncation"
    | "report_thresholding"
    | "other_row"
    | "report_sampling"
    | "schema_restriction"
  rangeStart: string
  rangeEnd: string
  propertyTimeZone: string
  watchScope: {
    version: "jesusfilm-watch-v1"
    hosts: typeof WATCH_HOSTS
    pathRegex: typeof WATCH_PATH_REGEX
    excludedEventCounts: "unknown"
  }
  totals: Record<(typeof EVENT_NAMES)[number], number>
  videostartsByMonth: { month: string; events: number }[]
  mediaComponentIdCoverage: {
    sourceDimension: "customEvent:mediacomponentid"
    eventName: "videostarts"
    inScopeEvents: number
    withMediaComponentIdEvents: number
    canonicalVideoMappedEvents: null
  }
  pagination: {
    complete: true
    monthlyRows: number
    identifiedRows: number
    requestCount: number
    pageCount: number
  }
  sourceAvailableAfter: string | null
  truncatedDateRanges: { startDate: string; endDate: string }[]
  truncationTypes: string[]
  reportLimitations: (
    | "source_truncation"
    | "report_thresholding"
    | "other_row"
    | "report_sampling"
    | "schema_restriction"
  )[]
  botFiltering: "unknown"
  exposure: "unavailable"
  transitionEvidence: "unavailable"
  snapshotConsistency: "not_frozen"
  costQualification: "usage_only_no_monetary_cost"
  resultDigest: string
}

type TokenProvider = () => Promise<
  { ok: true; accessToken: string } | { ok: false }
>

async function defaultTokenProvider(serviceAccountEmail: string) {
  try {
    const sourceClient = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient()
    const client = new Impersonated({
      sourceClient,
      targetPrincipal: serviceAccountEmail,
      targetScopes: [GA_SCOPE],
      lifetime: 600,
    })
    const token = (await client.getAccessToken()).token
    return token
      ? { ok: true as const, accessToken: token }
      : { ok: false as const }
  } catch {
    return { ok: false as const }
  }
}

async function accessToken(input: {
  serviceAccountEmail: string
  tokenProvider?: TokenProvider
}): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      input.tokenProvider?.() ??
        defaultTokenProvider(input.serviceAccountEmail),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), 45_000)
      }),
    ])
    if (!result.ok) throw new HistoricalAnalyticsError("analytics_unavailable")
    return result.accessToken
  } catch {
    throw new HistoricalAnalyticsError("analytics_unavailable")
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function date(value: string): boolean {
  return z.iso.date().safeParse(value).success
}

function count(value: string): number {
  const parsed = Number(value)
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed))
    throw new HistoricalAnalyticsError("analytics_incomplete")
  return parsed
}

function exactFilter(fieldName: string, value: string) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: "EXACT", value, caseSensitive: true },
    },
  }
}

type ReportKind = "monthly" | "identified" | "startPaths" | "referrerPairs"

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function referrerRegexFor(sourcePathnames?: readonly string[]) {
  return sourcePathnames
    ? `^https?://(www\\.)?jesusfilm\\.org(?:${sourcePathnames.map(escapedRegex).join("|")})(?:[?#].*)?$`
    : WATCH_REFERRER_REGEX
}

function validWatchPathnames(pathnames: readonly string[]): boolean {
  return (
    pathnames.length > 0 &&
    pathnames.length <= 50 &&
    new Set(pathnames).size === pathnames.length &&
    pathnames.every(
      (path) =>
        path.length <= 300 && path.startsWith("/watch/") && !/[?#]/u.test(path),
    )
  )
}

function watchFilter(
  kind: ReportKind,
  sourcePathnames?: readonly string[],
  targetPathnames?: readonly string[],
  sourceRouteRegex?: string,
  targetRouteRegex?: string,
) {
  const referrerRegex = sourceRouteRegex ?? referrerRegexFor(sourcePathnames)
  return {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "hostName",
            inListFilter: { values: WATCH_HOSTS, caseSensitive: true },
          },
        },
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: {
              matchType: "FULL_REGEXP",
              value: WATCH_PATH_REGEX,
              caseSensitive: true,
            },
          },
        },
        ...(targetPathnames
          ? [
              {
                filter: {
                  fieldName: "pagePath",
                  inListFilter: {
                    values: targetPathnames,
                    caseSensitive: true,
                  },
                },
              },
            ]
          : []),
        ...(targetRouteRegex
          ? [
              {
                filter: {
                  fieldName: "pagePath",
                  stringFilter: {
                    matchType: "FULL_REGEXP",
                    value: targetRouteRegex,
                    caseSensitive: true,
                  },
                },
              },
            ]
          : []),
        ...(kind !== "monthly"
          ? [
              exactFilter("eventName", "videostarts"),
              ...(kind === "identified"
                ? [
                    {
                      notExpression: {
                        filter: {
                          fieldName: "customEvent:mediacomponentid",
                          inListFilter: {
                            values: ["", "(not set)"],
                            caseSensitive: true,
                          },
                        },
                      },
                    },
                  ]
                : []),
              ...(kind === "referrerPairs"
                ? [
                    {
                      filter: {
                        fieldName: "pageReferrer",
                        stringFilter: {
                          matchType: "FULL_REGEXP",
                          value: referrerRegex,
                          caseSensitive: true,
                        },
                      },
                    },
                  ]
                : []),
            ]
          : [
              {
                filter: {
                  fieldName: "eventName",
                  inListFilter: {
                    values: EVENT_NAMES,
                    caseSensitive: true,
                  },
                },
              },
            ]),
      ],
    },
  }
}

async function requestReportPage(input: {
  propertyId: string
  rangeStart: string
  rangeEnd: string
  dimensions: string[]
  kind: ReportKind
  sourcePathnames?: readonly string[]
  targetPathnames?: readonly string[]
  sourceRouteRegex?: string
  targetRouteRegex?: string
  accessToken: string
  limit: number
  offset: number
  fetchImpl?: typeof fetch
}): Promise<Report & { transportAttempts: number }> {
  const response = await requestGoogleJson({
    url: new URL(
      `https://analyticsdata.googleapis.com/v1beta/properties/${input.propertyId}:runReport`,
    ),
    accessToken: input.accessToken,
    body: {
      dateRanges: [{ startDate: input.rangeStart, endDate: input.rangeEnd }],
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: [{ name: "eventCount" }],
      dimensionFilter: watchFilter(
        input.kind,
        input.sourcePathnames,
        input.targetPathnames,
        input.sourceRouteRegex,
        input.targetRouteRegex,
      ),
      orderBys: input.dimensions.map((dimensionName) => ({
        dimension: { dimensionName },
      })),
      limit: String(input.limit),
      offset: String(input.offset),
      returnPropertyQuota: true,
    },
    timeoutMs:
      input.kind === "monthly" || input.kind === "identified"
        ? COVERAGE_REPORT_TIMEOUT_MS
        : DETAILED_REPORT_TIMEOUT_MS,
    maxResponseBytes: 2_097_152,
    maxAttempts: 2,
    fetchImpl: input.fetchImpl,
  })
  if (!response.ok) throw new HistoricalAnalyticsError("analytics_unavailable")
  const parsed = reportSchema.safeParse(response.body)
  if (!parsed.success)
    throw new HistoricalAnalyticsError("analytics_incomplete")
  if (
    parsed.data.rowCount === undefined &&
    (parsed.data.rows.length > 0 || input.offset > 0)
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const page: Report = {
    ...parsed.data,
    rowCount: parsed.data.rowCount ?? 0,
  }
  if (
    page.dimensionHeaders.map(({ name }) => name).join("|") !==
      input.dimensions.join("|") ||
    page.metricHeaders.length !== 1 ||
    page.metricHeaders[0]?.name !== "eventCount" ||
    page.rows.length !==
      Math.min(input.limit, Math.max(0, page.rowCount - input.offset)) ||
    page.rows.some(
      (row) =>
        row.dimensionValues.length !== input.dimensions.length ||
        row.metricValues.length !== 1,
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  return { ...page, transportAttempts: response.attempts }
}

async function runReport(input: {
  propertyId: string
  rangeStart: string
  rangeEnd: string
  dimensions: string[]
  identifiedStarts: boolean
  accessToken: string
  pageSize: number
  fetchImpl?: typeof fetch
}): Promise<ReportResult> {
  const rows: ReportRow[] = []
  const seen = new Set<string>()
  let rowCount: number | null = null
  let timeZone: string | null = null
  let pageCount = 0
  let transportAttempts = 0
  let thresholded = false
  let otherRow = false
  let sampled = false
  let restricted = false
  let truncated = false
  let sourceAvailableAfter: string | null = null
  const truncatedDateRanges = new Map<
    string,
    { startDate: string; endDate: string }
  >()
  const truncationTypes = new Set<string>()
  do {
    if (pageCount >= MAX_REPORT_PAGES)
      throw new HistoricalAnalyticsError("analytics_incomplete")
    const page = await requestReportPage({
      ...input,
      kind: input.identifiedStarts ? "identified" : "monthly",
      limit: input.pageSize,
      offset: rows.length,
    })
    transportAttempts += page.transportAttempts
    if (
      (rowCount !== null && rowCount !== page.rowCount) ||
      (timeZone !== null && timeZone !== page.metadata.timeZone)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    rowCount = page.rowCount
    timeZone = page.metadata.timeZone
    thresholded ||= page.metadata.subjectToThresholding === true
    otherRow ||= page.metadata.dataLossFromOtherRow === true
    sampled ||= (page.metadata.samplingMetadatas?.length ?? 0) > 0
    restricted ||= page.metadata.schemaRestrictionResponse !== undefined
    truncated ||= (page.metadata.dataTruncationReasons?.length ?? 0) > 0
    for (const reason of page.metadata.dataTruncationReasons ?? []) {
      truncationTypes.add(reason.dataTruncationType)
      if (
        reason.dataTruncationDate &&
        (sourceAvailableAfter === null ||
          reason.dataTruncationDate > sourceAvailableAfter)
      )
        sourceAvailableAfter = reason.dataTruncationDate
      for (const range of reason.dataTruncationDateRanges ?? [])
        truncatedDateRanges.set(`${range.startDate}:${range.endDate}`, range)
    }
    for (const row of page.rows) {
      const dimensions = row.dimensionValues.map(({ value }) => value)
      const key = JSON.stringify(dimensions)
      if (seen.has(key))
        throw new HistoricalAnalyticsError("analytics_incomplete")
      seen.add(key)
      rows.push({ dimensions, count: count(row.metricValues[0]!.value) })
    }
    pageCount += 1
  } while (rowCount !== null && rows.length < rowCount)
  return {
    rows,
    rowCount: rowCount!,
    pageCount,
    transportAttempts,
    timeZone: timeZone!,
    thresholded,
    otherRow,
    sampled,
    restricted,
    truncated,
    sourceAvailableAfter,
    truncatedDateRanges: [...truncatedDateRanges.values()],
    truncationTypes: [...truncationTypes],
  }
}

/** GA reports are aggregate discovery only; they cannot prove ordered starts. */
export async function inspectGaWatchCoverage(input: {
  propertyId: string
  serviceAccountEmail: string
  rangeStart: string
  rangeEnd: string
  pageSize?: number
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}): Promise<GaWatchCoverage> {
  if (
    !/^\d{1,20}$/u.test(input.propertyId) ||
    !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/u.test(
      input.serviceAccountEmail,
    ) ||
    !date(input.rangeStart) ||
    !date(input.rangeEnd) ||
    input.rangeStart > input.rangeEnd
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const pageSize = input.pageSize ?? REPORT_PAGE_SIZE
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > REPORT_PAGE_SIZE
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const token = await accessToken(input)

  const common = {
    propertyId: input.propertyId,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    accessToken: token,
    pageSize,
    fetchImpl: input.fetchImpl,
  }
  const monthly = await runReport({
    ...common,
    dimensions: ["yearMonth", "eventName"],
    identifiedStarts: false,
  })
  const identified = await runReport({
    ...common,
    dimensions: ["year"],
    identifiedStarts: true,
  })
  if (
    monthly.timeZone !== identified.timeZone ||
    (input.propertyId === GA_WATCH_PROPERTY.id &&
      monthly.timeZone !== GA_WATCH_PROPERTY.timeZone)
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")

  const totals = Object.fromEntries(
    EVENT_NAMES.map((name) => [name, 0]),
  ) as GaWatchCoverage["totals"]
  const startsByMonth = new Map<string, number>()
  for (const row of monthly.rows) {
    const [month, eventName] = row.dimensions
    if (
      !/^\d{4}(?:0[1-9]|1[0-2])$/u.test(month!) ||
      month! < input.rangeStart.replaceAll("-", "").slice(0, 6) ||
      month! > input.rangeEnd.replaceAll("-", "").slice(0, 6) ||
      !EVENT_NAMES.includes(eventName as never)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    totals[eventName as keyof typeof totals] += row.count
    if (eventName === "videostarts") startsByMonth.set(month!, row.count)
  }
  let withMediaComponentIdEvents = 0
  for (const row of identified.rows) {
    if (
      !/^\d{4}$/u.test(row.dimensions[0]!) ||
      row.dimensions[0]! < input.rangeStart.slice(0, 4) ||
      row.dimensions[0]! > input.rangeEnd.slice(0, 4)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    withMediaComponentIdEvents += row.count
  }
  if (
    !Number.isSafeInteger(withMediaComponentIdEvents) ||
    withMediaComponentIdEvents > totals.videostarts ||
    Object.values(totals).some((value) => !Number.isSafeInteger(value))
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")

  const thresholded = monthly.thresholded || identified.thresholded
  const otherRow = monthly.otherRow || identified.otherRow
  const sampled = monthly.sampled || identified.sampled
  const restricted = monthly.restricted || identified.restricted
  const truncated = monthly.truncated || identified.truncated
  const sourceAvailableAfter =
    [monthly.sourceAvailableAfter, identified.sourceAvailableAfter]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  const truncatedDateRanges = [
    ...monthly.truncatedDateRanges,
    ...identified.truncatedDateRanges,
  ].filter(
    (range, index, all) =>
      all.findIndex(
        (other) =>
          other.startDate === range.startDate &&
          other.endDate === range.endDate,
      ) === index,
  )
  const reportLimitations: GaWatchCoverage["reportLimitations"] = [
    ...(truncated ? ["source_truncation" as const] : []),
    ...(thresholded ? ["report_thresholding" as const] : []),
    ...(sampled ? ["report_sampling" as const] : []),
    ...(restricted ? ["schema_restriction" as const] : []),
    ...(otherRow ? ["other_row" as const] : []),
  ]
  const reason = truncated
    ? "source_truncation"
    : thresholded
      ? "report_thresholding"
      : sampled
        ? "report_sampling"
        : restricted
          ? "schema_restriction"
          : otherRow
            ? "other_row"
            : "missing_session_identity"
  const videostartsByMonth = [...startsByMonth].map(([month, events]) => ({
    month,
    events,
  }))
  const resultDigest = createHash("sha256")
    .update(
      JSON.stringify({ monthly: monthly.rows, identified: identified.rows }),
    )
    .digest("hex")
  return {
    provider: "ga_data_api",
    propertyId: input.propertyId,
    status: reason === "missing_session_identity" ? "blocked" : "incomplete",
    reason,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    propertyTimeZone: monthly.timeZone,
    watchScope: {
      version: "jesusfilm-watch-v1",
      hosts: WATCH_HOSTS,
      pathRegex: WATCH_PATH_REGEX,
      excludedEventCounts: "unknown",
    },
    totals,
    videostartsByMonth,
    mediaComponentIdCoverage: {
      sourceDimension: "customEvent:mediacomponentid",
      eventName: "videostarts",
      inScopeEvents: totals.videostarts,
      withMediaComponentIdEvents,
      canonicalVideoMappedEvents: null,
    },
    pagination: {
      complete: true,
      monthlyRows: monthly.rowCount,
      identifiedRows: identified.rowCount,
      requestCount: monthly.transportAttempts + identified.transportAttempts,
      pageCount: monthly.pageCount + identified.pageCount,
    },
    sourceAvailableAfter,
    truncatedDateRanges,
    truncationTypes: [
      ...new Set([...monthly.truncationTypes, ...identified.truncationTypes]),
    ],
    reportLimitations,
    botFiltering: "unknown",
    exposure: "unavailable",
    transitionEvidence: "unavailable",
    snapshotConsistency: "not_frozen",
    costQualification: "usage_only_no_monetary_cost",
    resultDigest,
  }
}

/** One read-only GA aggregate page. Paths and media IDs are mapping leads, not Video IDs. */
export async function readGaWatchStartAggregatePage(input: {
  propertyId: string
  serviceAccountEmail: string
  rangeStart: string
  rangeEnd: string
  offset: number
  limit: number
  targetPathnames?: readonly string[]
  targetRouteRegex?: string
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}): Promise<{
  provider: "ga_data_api"
  status: "unqualified" | "incomplete"
  propertyId: string
  rangeStart: string
  rangeEnd: string
  rows: {
    pagePath: string
    mediaComponentId: string
    starts: number
    rowIdentityDigest: string
  }[]
  rowCount: number
  nextOffset: number | null
  requestCount: number
  propertyTimeZone: string
  reportLimitations: GaWatchCoverage["reportLimitations"]
  sourceAvailableAfter: string | null
  truncatedDateRanges: { startDate: string; endDate: string }[]
  truncationTypes: string[]
  canonicalMapping: "unverified"
  orderedTransitions: "unavailable"
  botFiltering: "unknown"
  snapshotConsistency: "not_frozen"
}> {
  if (
    !/^\d{1,20}$/u.test(input.propertyId) ||
    !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/u.test(
      input.serviceAccountEmail,
    ) ||
    !date(input.rangeStart) ||
    !date(input.rangeEnd) ||
    input.rangeStart > input.rangeEnd ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > SNAPSHOT_PAGE_SIZE
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  if (input.targetPathnames && !validWatchPathnames(input.targetPathnames))
    throw new HistoricalAnalyticsError("analytics_unavailable")
  if (
    input.targetRouteRegex &&
    (input.targetRouteRegex.length > 4_096 || input.targetPathnames)
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const token = await accessToken(input)
  const page = await requestReportPage({
    ...input,
    dimensions: ["pagePath", "customEvent:mediacomponentid"],
    kind: "startPaths",
    accessToken: token,
  })
  if (
    input.propertyId === GA_WATCH_PROPERTY.id &&
    page.metadata.timeZone !== GA_WATCH_PROPERTY.timeZone
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const reportLimitations: GaWatchCoverage["reportLimitations"] = [
    ...((page.metadata.dataTruncationReasons?.length ?? 0) > 0
      ? ["source_truncation" as const]
      : []),
    ...(page.metadata.subjectToThresholding
      ? ["report_thresholding" as const]
      : []),
    ...((page.metadata.samplingMetadatas?.length ?? 0) > 0
      ? ["report_sampling" as const]
      : []),
    ...(page.metadata.schemaRestrictionResponse !== undefined
      ? ["schema_restriction" as const]
      : []),
    ...(page.metadata.dataLossFromOtherRow ? ["other_row" as const] : []),
  ]
  const rows = page.rows.map((row) => {
    const pagePath = row.dimensionValues[0]!.value
    if (
      (pagePath !== "/watch" && !pagePath.startsWith("/watch/")) ||
      pagePath.length > 2_000
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    return {
      pagePath,
      mediaComponentId: row.dimensionValues[1]!.value,
      starts: count(row.metricValues[0]!.value),
      rowIdentityDigest: createHash("sha256")
        .update(JSON.stringify(row.dimensionValues.map(({ value }) => value)))
        .digest("hex"),
    }
  })
  return {
    provider: "ga_data_api",
    status: reportLimitations.length > 0 ? "incomplete" : "unqualified",
    propertyId: input.propertyId,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    rows,
    rowCount: page.rowCount,
    nextOffset:
      input.offset + rows.length < page.rowCount
        ? input.offset + rows.length
        : null,
    requestCount: page.transportAttempts,
    propertyTimeZone: page.metadata.timeZone,
    reportLimitations,
    sourceAvailableAfter:
      page.metadata.dataTruncationReasons
        ?.map((reason) => reason.dataTruncationDate)
        .filter((value): value is string => value !== undefined)
        .sort()
        .at(-1) ?? null,
    truncatedDateRanges:
      page.metadata.dataTruncationReasons?.flatMap(
        (reason) => reason.dataTruncationDateRanges ?? [],
      ) ?? [],
    truncationTypes: [
      ...new Set(
        page.metadata.dataTruncationReasons?.map(
          (reason) => reason.dataTruncationType,
        ) ?? [],
      ),
    ],
    canonicalMapping: "unverified",
    orderedTransitions: "unavailable",
    botFiltering: "unknown",
    snapshotConsistency: "not_frozen",
  }
}

type ReferrerRowStatus =
  | "candidate"
  | "homepage"
  | "self"
  | "cross_host"
  | "malformed"
  | "out_of_watch"

function watchPath(path: string): boolean {
  return path === "/watch" || path.startsWith("/watch/")
}

function classifyReferrerRow(
  referrer: string,
  pagePath: string,
): {
  sourcePath: string | null
  targetPath: string | null
  status: ReferrerRowStatus
} {
  let source: URL
  let target: URL
  if (
    referrer.length > 2_000 ||
    pagePath.length > 2_000 ||
    !pagePath.startsWith("/") ||
    pagePath.startsWith("//")
  )
    return { sourcePath: null, targetPath: null, status: "malformed" }
  try {
    source = new URL(referrer)
    target = new URL(pagePath, "https://jesusfilm.org")
  } catch {
    return { sourcePath: null, targetPath: null, status: "malformed" }
  }
  const sourcePath = source.pathname
  const targetPath = target.pathname
  if (target.hostname !== "jesusfilm.org")
    return { sourcePath: null, targetPath: null, status: "malformed" }
  if (
    !["http:", "https:"].includes(source.protocol) ||
    source.username ||
    source.password ||
    source.port ||
    !WATCH_HOSTS.includes(source.hostname as (typeof WATCH_HOSTS)[number])
  )
    return { sourcePath: null, targetPath, status: "cross_host" }
  if (!watchPath(sourcePath) || !watchPath(targetPath))
    return { sourcePath, targetPath, status: "out_of_watch" }
  if (
    sourcePath === "/watch" ||
    sourcePath === "/watch/" ||
    targetPath === "/watch" ||
    targetPath === "/watch/"
  )
    return { sourcePath, targetPath, status: "homepage" }
  if (sourcePath === targetPath)
    return { sourcePath, targetPath, status: "self" }
  return { sourcePath, targetPath, status: "candidate" }
}

/** Bounded aggregate evidence only; no URL spelling is treated as a Video ID. */
export async function readGaWatchReferrerAggregatePage(input: {
  propertyId: string
  serviceAccountEmail: string
  rangeStart: string
  rangeEnd: string
  offset: number
  limit: number
  sourcePathnames?: readonly string[]
  targetPathnames?: readonly string[]
  sourceRouteRegex?: string
  targetRouteRegex?: string
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}): Promise<{
  provider: "ga_data_api"
  status: "unqualified" | "incomplete"
  rows: {
    sourcePath: string | null
    targetPath: string | null
    mediaComponentId: string
    starts: number
    status: ReferrerRowStatus
    rowIdentityDigest: string
  }[]
  rowCount: number
  nextOffset: number | null
  requestCount: number
  pageCoverage: Record<`${ReferrerRowStatus}Events`, number>
  outsideReportEvents: "unknown"
  orderedTransitions: "unavailable"
  reportLimitations: GaWatchCoverage["reportLimitations"]
  sourceAvailableAfter: string | null
  truncationTypes: string[]
}> {
  if (
    !/^\d{1,20}$/u.test(input.propertyId) ||
    !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/u.test(
      input.serviceAccountEmail,
    ) ||
    !date(input.rangeStart) ||
    !date(input.rangeEnd) ||
    input.rangeStart > input.rangeEnd ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > SNAPSHOT_PAGE_SIZE
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  if (
    (input.sourcePathnames &&
      (!validWatchPathnames(input.sourcePathnames) ||
        referrerRegexFor(input.sourcePathnames).length > 4_096)) ||
    (input.targetPathnames && !validWatchPathnames(input.targetPathnames)) ||
    (input.sourceRouteRegex &&
      (input.sourceRouteRegex.length > 4_096 || input.sourcePathnames)) ||
    (input.targetRouteRegex &&
      (input.targetRouteRegex.length > 4_096 || input.targetPathnames))
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const token = await accessToken(input)
  const page = await requestReportPage({
    ...input,
    dimensions: ["pageReferrer", "pagePath", "customEvent:mediacomponentid"],
    kind: "referrerPairs",
    accessToken: token,
  })
  if (
    input.propertyId === GA_WATCH_PROPERTY.id &&
    page.metadata.timeZone !== GA_WATCH_PROPERTY.timeZone
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const rows = page.rows.map((row) => ({
    ...classifyReferrerRow(
      row.dimensionValues[0]!.value,
      row.dimensionValues[1]!.value,
    ),
    mediaComponentId: row.dimensionValues[2]!.value,
    starts: count(row.metricValues[0]!.value),
    rowIdentityDigest: createHash("sha256")
      .update(JSON.stringify(row.dimensionValues.map(({ value }) => value)))
      .digest("hex"),
  }))
  const pageCoverage = {
    candidateEvents: 0,
    homepageEvents: 0,
    selfEvents: 0,
    cross_hostEvents: 0,
    malformedEvents: 0,
    out_of_watchEvents: 0,
  }
  for (const row of rows) pageCoverage[`${row.status}Events`] += row.starts
  const reportLimitations: GaWatchCoverage["reportLimitations"] = [
    ...((page.metadata.dataTruncationReasons?.length ?? 0) > 0
      ? ["source_truncation" as const]
      : []),
    ...(page.metadata.subjectToThresholding
      ? ["report_thresholding" as const]
      : []),
    ...((page.metadata.samplingMetadatas?.length ?? 0) > 0
      ? ["report_sampling" as const]
      : []),
    ...(page.metadata.schemaRestrictionResponse !== undefined
      ? ["schema_restriction" as const]
      : []),
    ...(page.metadata.dataLossFromOtherRow ? ["other_row" as const] : []),
  ]
  return {
    provider: "ga_data_api",
    status: reportLimitations.length > 0 ? "incomplete" : "unqualified",
    rows,
    rowCount: page.rowCount,
    nextOffset:
      input.offset + rows.length < page.rowCount
        ? input.offset + rows.length
        : null,
    requestCount: page.transportAttempts,
    pageCoverage,
    outsideReportEvents: "unknown",
    orderedTransitions: "unavailable",
    reportLimitations,
    sourceAvailableAfter:
      page.metadata.dataTruncationReasons
        ?.map((reason) => reason.dataTruncationDate)
        .filter((value): value is string => value !== undefined)
        .sort()
        .at(-1) ?? null,
    truncationTypes: [
      ...new Set(
        page.metadata.dataTruncationReasons?.map(
          (reason) => reason.dataTruncationType,
        ) ?? [],
      ),
    ],
  }
}

type NavigationSnapshotInput = Parameters<
  NonNullable<HistoricalAnalyticsReader["readNavigationSnapshot"]>
>[0]

function* watchRoutes(video: WatchRouteCatalogVideo): Generator<string> {
  const identity = video.watchRouteIdentity
  if (identity.truncated) return
  for (const language of identity.playableAudioLanguageSlugs) {
    yield `/watch/${video.slug}.html/${language}.html`
    if (language === "english") yield `/watch/${video.slug}.html`
    for (const parent of identity.parentSlugs) {
      yield `/watch/${parent}.html/${video.slug}/${language}.html`
      yield `/watch/${parent}.html/${video.slug}.html/${language}.html`
      if (language === "english") {
        yield `/watch/${parent}.html/${video.slug}`
        yield `/watch/${parent}.html/${video.slug}.html`
      }
    }
  }
}

function routePatterns(video: WatchRouteCatalogVideo): string[] {
  const child = escapedRegex(video.slug)
  return [
    `/watch/${child}\\.html(?:/[a-z0-9-]+\\.html)?`,
    ...video.watchRouteIdentity.parentSlugs.map(
      (parent) =>
        `/watch/${escapedRegex(parent)}\\.html/${child}(?:\\.html)?(?:/[a-z0-9-]+\\.html)?`,
    ),
  ]
}

function routeRegex(
  kind: "source" | "target",
  patterns: readonly string[],
): string {
  const path = `(?:${patterns.join("|")})`
  return kind === "source"
    ? `^https?://(www\\.)?jesusfilm\\.org${path}(?:[?#].*)?$`
    : `^${path}$`
}

function patternChunks(
  kind: "source" | "target",
  patterns: readonly string[],
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  for (const pattern of patterns) {
    if (
      current.length > 0 &&
      (current.length >= 50 ||
        routeRegex(kind, [...current, pattern]).length > 4_096)
    ) {
      chunks.push(current)
      current = []
    }
    current.push(pattern)
    if (routeRegex(kind, current).length > 4_096)
      throw new HistoricalAnalyticsError("analytics_mapping_unverified")
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Route-prefix preflight for a bounded pair; actual rows still require local mapping. */
export function planGaWatchNavigationFilters(
  source: WatchRouteCatalogVideo,
  target: WatchRouteCatalogVideo,
): { sourceRouteRegex: string; targetRouteRegex: string }[] {
  return patternChunks("source", routePatterns(source)).flatMap((from) =>
    patternChunks("target", routePatterns(target)).map((to) => ({
      sourceRouteRegex: routeRegex("source", from),
      targetRouteRegex: routeRegex("target", to),
    })),
  )
}

async function readGaNavigationSnapshot(
  input: {
    propertyId: string
    serviceAccountEmail: string
    rangeStart: string
    rangeEnd: string
    tokenProvider?: TokenProvider
    fetchImpl?: typeof fetch
  } & NavigationSnapshotInput,
): Promise<HistoricalSnapshot> {
  const { definition, cutoff } = input
  if (
    definition.qualification.sourceAvailability.requestedStart !==
      input.rangeStart ||
    definition.qualification.sourceAvailability.requestedEnd !== input.rangeEnd
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const routeCatalog = input.routeCatalog.filter(
    (video): video is typeof video & WatchRouteCatalogVideo =>
      video.watchRouteIdentity?.basis === "current_catalog_cutoff_fenced",
  )
  if (routeCatalog.length !== input.routeCatalog.length)
    throw new HistoricalAnalyticsError("analytics_mapping_unverified")
  const mapWatchPath = createWatchRouteMapper(routeCatalog)
  const source = routeCatalog.find((video) => video.id === input.sourceVideoId)
  if (!source)
    throw new HistoricalAnalyticsError("analytics_mapping_unverified")
  const selected = new Set(input.selectedVideoIds)
  if (
    selected.has(source.id) ||
    selected.size !== input.selectedVideoIds.length ||
    [...selected].some((id) => !input.catalog.some((video) => video.id === id))
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const hasUniqueRoute = (video: WatchRouteCatalogVideo) => {
    for (const path of watchRoutes(video)) {
      if (path.length > 300) continue
      const match = mapWatchPath(path)
      if (match.status === "mapped" && match.videoId === video.id) return true
    }
    return false
  }
  if (!hasUniqueRoute(source))
    throw new HistoricalAnalyticsError("analytics_mapping_unverified")
  const sourceBatches = patternChunks("source", routePatterns(source))
  const queryableSelected = new Set<string>()
  const targetPatterns: string[] = []
  for (const id of selected) {
    const video = routeCatalog.find((item) => item.id === id)!
    if (!hasUniqueRoute(video)) continue
    queryableSelected.add(id)
    targetPatterns.push(...routePatterns(video))
  }
  const engagementPatterns = input.includeSourceEngagement
    ? routePatterns(source)
    : [...new Set(targetPatterns)]
  const navigationTargets = [...new Set(targetPatterns)]
  const engagementByVideo = new Map<string, number>()
  const navigationByPair = new Map<string, number>()
  const seenEngagement = new Map<string, number>()
  const seenNavigation = new Map<string, number>()
  const navigationCoverage = {
    candidateEvents: 0,
    qualifiedEvents: 0,
    homeEvents: 0,
    selfEvents: 0,
    crossHostEvents: 0,
    malformedEvents: 0,
    unmappedEvents: 0,
    ambiguousEvents: 0,
  }
  const usage = new Map<string, number | null>()
  const mappingDigest = createHash("sha256")
    .update(
      JSON.stringify(
        routeCatalog.map((video) => ({
          id: video.id,
          slug: video.slug,
          watchRouteIdentity: video.watchRouteIdentity,
        })),
      ),
    )
    .digest("hex")
  const resultHash = createHash("sha256")
  const unmappedHash = createHash("sha256")
  let rowCount = 0
  let mappedRows = 0
  let unmappedRows = 0
  let pageCount = 0
  const usableInput = {
    propertyId: input.propertyId,
    serviceAccountEmail: input.serviceAccountEmail,
    rangeStart: definition.rangeStart,
    rangeEnd: definition.rangeEnd,
    tokenProvider: input.tokenProvider,
    fetchImpl: input.fetchImpl,
  }
  const add = (value: number, increment: number) => {
    const sum = value + increment
    if (!Number.isSafeInteger(sum))
      throw new HistoricalAnalyticsError("analytics_incomplete")
    return sum
  }
  const firstSeen = (
    seen: Map<string, number>,
    digest: string,
    starts: number,
  ) => {
    const prior = seen.get(digest)
    if (prior !== undefined) {
      if (prior !== starts)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      return false
    }
    seen.set(digest, starts)
    rowCount = add(rowCount, 1)
    return true
  }
  async function pages<
    T extends {
      rows: { starts: number }[]
      rowCount: number
      nextOffset: number | null
      status: "unqualified" | "incomplete"
    },
  >(
    kind: "engagement" | "navigation",
    patterns: string[],
    querySourcePatterns: string[],
    read: (offset: number) => Promise<T>,
    accept: (row: T["rows"][number]) => void,
  ) {
    const queryId = `ga_${createHash("sha256")
      .update(
        JSON.stringify({
          kind,
          patterns,
          querySourcePatterns,
          rangeStart: definition.rangeStart,
          rangeEnd: definition.rangeEnd,
          cutoff,
          mappingDigest,
        }),
      )
      .digest("hex")
      .slice(0, 40)}`
    usage.set(queryId, null)
    let offset = 0
    let expected: number | null = null
    while (true) {
      const page = await read(offset)
      if (
        page.status !== "unqualified" ||
        (expected !== null && page.rowCount !== expected) ||
        (page.nextOffset !== null &&
          (page.nextOffset !== offset + page.rows.length ||
            !Number.isSafeInteger(page.nextOffset) ||
            page.nextOffset <= offset ||
            page.nextOffset > page.rowCount))
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      expected = page.rowCount
      pageCount = add(pageCount, 1)
      for (const row of page.rows) accept(row)
      if (page.nextOffset === null) {
        if (offset + page.rows.length !== expected)
          throw new HistoricalAnalyticsError("analytics_incomplete")
        return
      }
      offset = page.nextOffset
    }
  }
  for (const patterns of patternChunks("target", engagementPatterns)) {
    await pages(
      "engagement",
      patterns,
      [],
      (offset) =>
        readGaWatchStartAggregatePage({
          ...usableInput,
          offset,
          limit: SNAPSHOT_PAGE_SIZE,
          targetRouteRegex: routeRegex("target", patterns),
        }),
      (row) => {
        const signal = row as Awaited<
          ReturnType<typeof readGaWatchStartAggregatePage>
        >["rows"][number]
        if (!firstSeen(seenEngagement, signal.rowIdentityDigest, signal.starts))
          return
        const match = mapWatchPath(signal.pagePath)
        if (
          match.status !== "mapped" ||
          !(input.includeSourceEngagement
            ? match.videoId === source.id
            : queryableSelected.has(match.videoId))
        ) {
          unmappedRows = add(unmappedRows, 1)
          unmappedHash.update(
            JSON.stringify({
              kind: "engagement",
              starts: signal.starts,
              status: match.status,
            }),
          )
          return
        }
        mappedRows = add(mappedRows, 1)
        resultHash.update(
          JSON.stringify({
            kind: "engagement",
            videoId: match.videoId,
            views: signal.starts,
          }),
        )
        engagementByVideo.set(
          match.videoId,
          add(engagementByVideo.get(match.videoId) ?? 0, signal.starts),
        )
      },
    )
  }
  for (const querySourcePatterns of sourceBatches) {
    for (const patterns of patternChunks("target", navigationTargets)) {
      await pages(
        "navigation",
        patterns,
        querySourcePatterns,
        (offset) =>
          readGaWatchReferrerAggregatePage({
            ...usableInput,
            offset,
            limit: SNAPSHOT_PAGE_SIZE,
            sourceRouteRegex: routeRegex("source", querySourcePatterns),
            targetRouteRegex: routeRegex("target", patterns),
          }),
        (row) => {
          const link = row as Awaited<
            ReturnType<typeof readGaWatchReferrerAggregatePage>
          >["rows"][number]
          if (!firstSeen(seenNavigation, link.rowIdentityDigest, link.starts))
            return
          navigationCoverage.candidateEvents = add(
            navigationCoverage.candidateEvents,
            link.starts,
          )
          let bucket: keyof typeof navigationCoverage
          if (link.status === "homepage") bucket = "homeEvents"
          else if (link.status === "self") bucket = "selfEvents"
          else if (link.status === "cross_host") bucket = "crossHostEvents"
          else if (
            link.status === "malformed" ||
            link.status === "out_of_watch"
          )
            bucket = "malformedEvents"
          else {
            const from = mapWatchPath(link.sourcePath!)
            const to = mapWatchPath(link.targetPath!)
            if (from.status === "ambiguous" || to.status === "ambiguous")
              bucket = "ambiguousEvents"
            else if (
              from.status !== "mapped" ||
              to.status !== "mapped" ||
              from.videoId !== source.id ||
              !queryableSelected.has(to.videoId)
            )
              bucket = "unmappedEvents"
            else if (from.videoId === to.videoId) bucket = "selfEvents"
            else {
              bucket = "qualifiedEvents"
              const pair = JSON.stringify([from.videoId, to.videoId])
              navigationByPair.set(
                pair,
                add(navigationByPair.get(pair) ?? 0, link.starts),
              )
            }
          }
          navigationCoverage[bucket] = add(
            navigationCoverage[bucket],
            link.starts,
          )
          if (bucket === "qualifiedEvents") {
            mappedRows = add(mappedRows, 1)
            resultHash.update(
              JSON.stringify({
                kind: "navigation",
                sourceVideoId: source.id,
                targetVideoId: mapWatchPath(link.targetPath!).videoId,
                starts: link.starts,
              }),
            )
          } else {
            unmappedRows = add(unmappedRows, 1)
            unmappedHash.update(
              JSON.stringify({
                kind: "navigation",
                bucket,
                starts: link.starts,
              }),
            )
          }
        },
      )
    }
  }
  const usageDigest = createHash("sha256")
    .update(JSON.stringify([...usage].sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex")
  const provenance: HistoricalSnapshot["provenance"] = {
    provider: "ga_data_api",
    status: "complete",
    queryId: definition.queryId,
    rangeStart: definition.rangeStart,
    rangeEnd: definition.rangeEnd,
    cutoff,
    identity: definition.identity,
    botFiltering: definition.botFiltering,
    measurement: definition.measurement,
    overlap: definition.overlap,
    qualification: definition.qualification,
    navigationCoverage,
    rowCount,
    catalogCandidates: input.includeSourceEngagement
      ? 0
      : input.catalog.length - 1,
    inspectedCandidates: queryableSelected.size,
    unmappedCandidates: selected.size - queryableSelected.size,
    mappedRows,
    unmappedRows,
    pageCount,
    queryExecutionCount: usage.size,
    queryUsageDigest: usageDigest,
    resultDigest: resultHash.digest("hex"),
    unmappedDigest: unmappedRows > 0 ? unmappedHash.digest("hex") : null,
    bytesProcessed: null,
    costQualification: "unavailable",
  }
  return {
    provenance,
    queryUsage: usage,
    definitionsForModel: {
      provider: definition.provider,
      queryId: definition.queryId,
      rangeStart: definition.rangeStart,
      rangeEnd: definition.rangeEnd,
      identity: definition.identity,
      botFiltering: definition.botFiltering,
      measurement: definition.measurement,
      overlap: definition.overlap,
      qualification: definition.qualification,
      engagement:
        "Observed videostarts on uniquely mapped Watch paths. Engaged views and exposures are unavailable; absent events do not imply low interest.",
      transitions:
        "Unavailable: GA has no verified session identity or playback order.",
      navigation:
        "Same-event pageReferrer-to-pagePath links, uniquely mapped through current catalog routes. These are navigation signals, not consecutive plays; bot filtering and historical URL ownership are unverified.",
    },
    signal(videoId) {
      const views = engagementByVideo.get(videoId)
      return views === undefined
        ? null
        : { videoKey: videoId, views, engagedViews: null, exposures: null }
    },
    transition() {
      return null
    },
    navigation(sourceVideoId, targetVideoId) {
      return (
        navigationByPair.get(JSON.stringify([sourceVideoId, targetVideoId])) ??
        null
      )
    },
  }
}

export function createGaWatchHistoryReader(input: {
  propertyId: string
  serviceAccountEmail: string
  rangeStart: string
  rangeEnd: string
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}): HistoricalAnalyticsReader & {
  inspectCoverage: () => Promise<GaWatchCoverage>
  readWatchStartsPage: (page: {
    offset: number
    limit: number
    targetPathnames?: readonly string[]
  }) => ReturnType<typeof readGaWatchStartAggregatePage>
  readWatchReferrerPage: (page: {
    offset: number
    limit: number
    sourcePathnames?: readonly string[]
    targetPathnames?: readonly string[]
    sourceRouteRegex?: string
    targetRouteRegex?: string
  }) => ReturnType<typeof readGaWatchReferrerAggregatePage>
} {
  let description: Awaited<
    ReturnType<HistoricalAnalyticsReader["describe"]>
  > | null = null
  let cachedToken: { accessToken: string; expiresAt: number } | null = null
  let pendingToken: Promise<Awaited<ReturnType<TokenProvider>>> | null = null
  const shared = {
    ...input,
    tokenProvider:
      input.tokenProvider ??
      (async () => {
        if (cachedToken && Date.now() < cachedToken.expiresAt)
          return { ok: true as const, accessToken: cachedToken.accessToken }
        pendingToken ??= defaultTokenProvider(input.serviceAccountEmail)
        try {
          const result = await pendingToken
          if (result.ok)
            cachedToken = {
              accessToken: result.accessToken,
              expiresAt: Date.now() + 8 * 60_000,
            }
          return result
        } finally {
          pendingToken = null
        }
      }),
  }
  return {
    evidenceKind: "referrer_navigation_v1",
    inspectCoverage: () => inspectGaWatchCoverage(shared),
    readWatchStartsPage: (page: {
      offset: number
      limit: number
      targetPathnames?: readonly string[]
    }) => readGaWatchStartAggregatePage({ ...shared, ...page }),
    readWatchReferrerPage: (page: {
      offset: number
      limit: number
      sourcePathnames?: readonly string[]
      targetPathnames?: readonly string[]
      sourceRouteRegex?: string
      targetRouteRegex?: string
    }) => readGaWatchReferrerAggregatePage({ ...shared, ...page }),
    async describe() {
      if (description) return description
      if (input.propertyId !== GA_WATCH_PROPERTY.id)
        throw new HistoricalAnalyticsError("analytics_unavailable")
      const requested = await inspectGaWatchCoverage(shared)
      const requestedReferrers = await readGaWatchReferrerAggregatePage({
        ...shared,
        offset: 0,
        limit: 1,
      })
      const fullReports = [requested, requestedReferrers]
      if (
        requestedReferrers.reportLimitations.join("|") !==
          "source_truncation" ||
        fullReports.some(
          (report) =>
            report.reportLimitations.some(
              (limitation) => limitation !== "source_truncation",
            ) ||
            report.truncationTypes.some(
              (type) => type !== "DATA_TRUNCATION_TYPE_PROPERTY",
            ) ||
            (report.reportLimitations.includes("source_truncation") &&
              report.sourceAvailableAfter === null),
        )
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const truncationDate = fullReports
        .map((report) => report.sourceAvailableAfter)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1)!
      const usableStart = new Date(`${truncationDate}T00:00:00.000Z`)
      usableStart.setUTCDate(usableStart.getUTCDate() + 1)
      const usableStartDate = usableStart.toISOString().slice(0, 10)
      if (usableStartDate > input.rangeEnd)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const usableInput = { ...shared, rangeStart: usableStartDate }
      const usable = await inspectGaWatchCoverage(usableInput)
      const usableReferrers = await readGaWatchReferrerAggregatePage({
        ...usableInput,
        offset: 0,
        limit: 1,
      })
      const usableStarts = await readGaWatchStartAggregatePage({
        ...usableInput,
        offset: 0,
        limit: 1,
      })
      if (
        usable.reportLimitations.length > 0 ||
        usable.reason !== "missing_session_identity" ||
        usableReferrers.status !== "unqualified" ||
        usableStarts.status !== "unqualified" ||
        usable.propertyTimeZone !== GA_WATCH_PROPERTY.timeZone
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      const observed = usable.videostartsByMonth
        .filter((month) => month.events > 0)
        .map((month) => month.month)
        .sort()
      description = {
        provider: "ga_data_api",
        queryId: "watch-referrer-navigation-v1",
        rangeStart: usableStartDate,
        rangeEnd: input.rangeEnd,
        identity: "current_catalog_watch_path",
        botFiltering: "unknown",
        measurement: "observed_events",
        overlap: "unknown",
        qualification: {
          evidenceKind: "referrer_navigation_v1",
          sourceResource: `properties/${input.propertyId}`,
          sourceAvailability: {
            coverage: "partial_source_history",
            requestedStart: input.rangeStart,
            requestedEnd: input.rangeEnd,
            truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
            truncationDate,
            unavailablePrefixStart: input.rangeStart,
            unavailablePrefixEnd: truncationDate,
            usableStart: usableStartDate,
            usableEnd: input.rangeEnd,
            observedFirstMonth: observed[0] ?? null,
            observedLastMonth: observed.at(-1) ?? null,
          },
          watchScope: {
            version: "jesusfilm-watch-v1",
            hosts: [...WATCH_HOSTS],
            pathRule: "watch-route-and-children",
            eventName: "videostarts",
            includedEvents: usable.totals.videostarts,
            totalEvents: null,
            missingUrlEvents: null,
            malformedUrlEvents: null,
            excludedHostEvents: null,
            excludedPathEvents: null,
          },
          mediaComponentIdCoverage: {
            sourceDimension: "customEvent:mediacomponentid",
            inScopeEvents: usable.totals.videostarts,
            withMediaComponentIdEvents:
              usable.mediaComponentIdCoverage.withMediaComponentIdEvents,
            canonicalVideoMappedEvents: null,
          },
          engagement: {
            definitionVersion: "watch-videostarts-v1",
            botBasis: "unverified",
            overlapIdentity: "unknown",
            exposures: "unavailable",
          },
          transitions: {
            status: "unavailable",
            reason: "missing_session_identity",
          },
          navigation: {
            status: "available",
            definitionVersion: "watch-referrer-v1",
            basis: "same_event_page_referrer_to_page_path",
            interpretation: "navigation_not_playback_sequence",
            botBasis: "unverified",
            overlapIdentity: "unknown",
          },
          mapping: {
            basis: "current_catalog_cutoff_fenced",
            historicalOwnership: "unverified",
          },
        },
      }
      return description
    },
    readNavigationSnapshot: (snapshot) =>
      readGaNavigationSnapshot({ ...shared, ...snapshot }),
    async readPage(): Promise<never> {
      throw new HistoricalAnalyticsError(
        "analytics_transition_missing_session_identity",
      )
    },
  }
}
