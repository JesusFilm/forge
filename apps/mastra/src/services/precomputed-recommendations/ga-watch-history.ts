import { createHash } from "node:crypto"

import { GoogleAuth, Impersonated } from "google-auth-library"
import { z } from "zod"

import { requestGoogleJson } from "../google-auth-client"
import { GA_WATCH_PROPERTY } from "./ga-watch-history-range"
import { HistoricalAnalyticsError } from "./historical-analytics"

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const WATCH_HOSTS = ["jesusfilm.org", "www.jesusfilm.org"] as const
const WATCH_PATH_REGEX = "^/watch(/.*)?$"
const REPORT_PAGE_SIZE = 1_000
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
        timer = setTimeout(() => resolve({ ok: false }), 15_000)
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

type ReportKind = "monthly" | "identified" | "startPaths"

function watchFilter(kind: ReportKind) {
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
      dimensionFilter: watchFilter(input.kind),
      orderBys: input.dimensions.map((dimensionName) => ({
        dimension: { dimensionName },
      })),
      limit: String(input.limit),
      offset: String(input.offset),
      returnPropertyQuota: true,
    },
    timeoutMs: 15_000,
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
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}): Promise<{
  provider: "ga_data_api"
  status: "unqualified" | "incomplete"
  propertyId: string
  rangeStart: string
  rangeEnd: string
  rows: { pagePath: string; mediaComponentId: string; starts: number }[]
  rowCount: number
  nextOffset: number | null
  requestCount: number
  propertyTimeZone: string
  reportLimitations: GaWatchCoverage["reportLimitations"]
  sourceAvailableAfter: string | null
  truncatedDateRanges: { startDate: string; endDate: string }[]
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
    input.limit > 100
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
    canonicalMapping: "unverified",
    orderedTransitions: "unavailable",
    botFiltering: "unknown",
    snapshotConsistency: "not_frozen",
  }
}

export function createGaWatchHistoryReader(input: {
  propertyId: string
  serviceAccountEmail: string
  rangeStart: string
  rangeEnd: string
  tokenProvider?: TokenProvider
  fetchImpl?: typeof fetch
}) {
  return {
    inspectCoverage: () => inspectGaWatchCoverage(input),
    readWatchStartsPage: (page: { offset: number; limit: number }) =>
      readGaWatchStartAggregatePage({ ...input, ...page }),
    async describe(): Promise<never> {
      const coverage = await inspectGaWatchCoverage(input)
      throw new HistoricalAnalyticsError(
        coverage.status === "incomplete"
          ? "analytics_incomplete"
          : "analytics_transition_missing_session_identity",
      )
    },
    async readPage(): Promise<never> {
      throw new HistoricalAnalyticsError(
        "analytics_transition_missing_session_identity",
      )
    },
  }
}
