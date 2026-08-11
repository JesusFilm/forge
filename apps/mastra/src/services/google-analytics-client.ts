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

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
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

function number(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

  const rows: Ga4Row[] = []
  let pageSize = boundedSeoProviderPageSize({
    maxRows: config.maxGa4Rows,
    maxResponseBytes: config.maxResponseBytes,
    providerMaxRows: 10_000,
  })
  let metadata: z.infer<typeof ResponseSchema>["metadata"]
  let propertyQuota: unknown
  let declaredRowCount: number | null = null
  while (rows.length < config.maxGa4Rows) {
    const requestedPageSize = Math.min(
      pageSize,
      config.maxGa4Rows - rows.length,
    )
    const response = await requestGoogleJson({
      url: new URL(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}:runReport`,
      ),
      accessToken: token.accessToken,
      body: {
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        ...(exactLandingPage
          ? {
              dimensionFilter: {
                filter: {
                  fieldName: "landingPagePlusQueryString",
                  stringFilter: {
                    matchType: "EXACT",
                    value: exactLandingPage,
                    caseSensitive: true,
                  },
                },
              },
            }
          : {}),
        limit: String(requestedPageSize),
        offset: String(rows.length),
        returnPropertyQuota: true,
      },
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      maxAttempts: config.maxProviderAttempts,
      fetchImpl: input.fetchImpl,
      sleep: input.sleep,
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
    if (!parsed.success)
      return { ok: false, reason: "parse_error", retryable: true }
    if (parsed.data.rows.length > requestedPageSize) {
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
        rows.length < Math.min(declaredRowCount, config.maxGa4Rows)
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
      const projectedDimensions = Object.fromEntries(
        dimensions.map((name, index) => {
          const value = row.dimensionValues[index]!.value
          if (name !== "landingPagePlusQueryString") return [name, value]
          const minimized = minimizeSeoUrl(
            `https://placeholder.invalid${value}`,
          )
          return [
            name,
            minimized
              ? new URL(minimized).pathname
              : (value.split("?")[0] ?? "/"),
          ]
        }),
      )
      const projectedMetrics: Record<string, number> = {}
      for (const [index, name] of metrics.entries()) {
        const parsedNumber = number(row.metricValues[index]!.value)
        if (parsedNumber == null) {
          return { ok: false, reason: "parse_error", retryable: true }
        }
        projectedMetrics[name] = parsedNumber
      }
      rows.push({ dimensions: projectedDimensions, metrics: projectedMetrics })
    }
    if (parsed.data.rows.length < requestedPageSize) {
      if (
        declaredRowCount != null &&
        rows.length < Math.min(declaredRowCount, config.maxGa4Rows)
      ) {
        return { ok: false, reason: "parse_error", retryable: true }
      }
      break
    }
  }

  const capped =
    rows.length >= config.maxGa4Rows &&
    declaredRowCount != null &&
    declaredRowCount > rows.length
  const thresholded = metadata?.subjectToThresholding === true
  const dataLoss = metadata?.dataLossFromOtherRow === true
  const caveats = [
    ...(thresholded
      ? ["GA4 reports this result as subject to thresholding."]
      : []),
    ...(dataLoss
      ? ["GA4 reports data loss from an aggregated other row."]
      : []),
    ...(capped ? ["Configured GA4 row cap was reached."] : []),
    "GA4 landing-page/date aggregates are guardrails and are not joined to individual Search Console queries or users.",
  ]
  const observation: SeoEvidenceObservation = {
    id:
      input.observationId ??
      `ga4-${createHash("sha256").update(`${input.propertyId}:${input.startDate}:${input.endDate}:${randomUUID()}`).digest("hex").slice(0, 20)}`,
    provider: "ga4",
    status: thresholded || dataLoss || capped ? "partial" : "available",
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
      declaredRowCount: declaredRowCount ?? rows.length,
      rows,
      propertyTimezone: metadata?.timeZone ?? null,
      currencyCode: metadata?.currencyCode ?? null,
      propertyQuota: propertyQuota ?? null,
    },
    quality: {
      complete: !thresholded && !dataLoss && !capped,
      truncated: capped,
      caveats,
    },
    sources: [],
  }
  return {
    ok: true,
    propertyId: input.propertyId,
    rows,
    observation,
    propertyTimezone: metadata?.timeZone ?? null,
  }
}
