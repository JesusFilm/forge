import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../config/seo"
import {
  getGoogleAccessToken,
  isGoogleApiDate,
  requestGoogleJson,
  type GoogleTokenProvider,
} from "./google-auth-client"
import type { SeoEvidenceObservation, SeoProviderFailure } from "./seo-evidence"
import { boundedSeoProviderPageSize } from "./seo-http"

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
const GSC_ENDPOINT = "https://searchconsole.googleapis.com/webmasters/v3/sites/"

const RowSchema = z
  .object({
    keys: z.array(z.string()).optional().default([]),
    clicks: z.number().finite().nonnegative().optional().default(0),
    impressions: z.number().finite().nonnegative().optional().default(0),
    ctr: z.number().finite().nonnegative().optional().default(0),
    position: z.number().finite().nonnegative().optional().default(0),
  })
  .passthrough()

const ResponseSchema = z
  .object({
    rows: z.array(RowSchema).optional().default([]),
    responseAggregationType: z.string().optional().nullable(),
    metadata: z
      .object({
        first_incomplete_date: z.string().optional(),
        first_incomplete_hour: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type GscDimension = "date" | "query" | "page" | "country" | "device"
export type GscDataState = "final" | "all" | "hourly_all"

export type GscRow = z.infer<typeof RowSchema>
export type GscQueryResult =
  | {
      ok: true
      propertyId: string
      rows: GscRow[]
      observation: SeoEvidenceObservation
      responseAggregationType: string | null
      firstIncompleteDate: string | null
    }
  | SeoProviderFailure

function endpoint(propertyId: string): URL {
  return new URL(
    `${encodeURIComponent(propertyId)}/searchAnalytics/query`,
    GSC_ENDPOINT,
  )
}

export async function queryGoogleSearchConsole(input: {
  propertyId: string
  startDate: string
  endDate: string
  dimensions: GscDimension[]
  dataState?: GscDataState
  filters?: Array<{
    dimension: GscDimension
    operator:
      | "equals"
      | "notEquals"
      | "contains"
      | "notContains"
      | "includingRegex"
      | "excludingRegex"
    expression: string
  }>
  config?: SeoConfig
  tokenProvider?: GoogleTokenProvider
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  observationId?: string
}): Promise<GscQueryResult> {
  const config = input.config ?? getSeoConfig()
  if (!config.gscPropertyIds.includes(input.propertyId)) {
    return { ok: false, reason: "not_allowed", retryable: false }
  }
  if (
    !isGoogleApiDate(input.startDate) ||
    !isGoogleApiDate(input.endDate) ||
    input.startDate > input.endDate ||
    input.dimensions.length === 0 ||
    input.dimensions.length > 5
  ) {
    return { ok: false, reason: "rejected", retryable: false }
  }
  const token = await (
    input.tokenProvider ?? ((scopes) => getGoogleAccessToken(scopes))
  )([GSC_SCOPE])
  if (!token.ok) return token

  let pageSize = boundedSeoProviderPageSize({
    maxRows: config.maxGscRows,
    maxResponseBytes: config.maxResponseBytes,
    providerMaxRows: 25_000,
  })
  const rows: GscRow[] = []
  let aggregation: string | null = null
  let firstIncompleteDate: string | null = null
  let pageCount = 0
  let requestCount = 0
  while (rows.length < config.maxGscRows) {
    const requestedPageSize = Math.min(
      pageSize,
      config.maxGscRows - rows.length,
    )
    const response = await requestGoogleJson({
      url: endpoint(input.propertyId),
      accessToken: token.accessToken,
      body: {
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        type: "web",
        dataState: input.dataState ?? "final",
        rowLimit: requestedPageSize,
        startRow: rows.length,
        ...(input.filters?.length
          ? {
              dimensionFilterGroups: [
                {
                  groupType: "and",
                  filters: input.filters.map((filter) => ({
                    dimension: filter.dimension,
                    operator: filter.operator,
                    expression: filter.expression.slice(0, 500),
                  })),
                },
              ],
            }
          : {}),
      },
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      maxAttempts: config.maxProviderAttempts,
      fetchImpl: input.fetchImpl,
      sleep: input.sleep,
    })
    requestCount += response.attempts
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
    if (!parsed.success) {
      return { ok: false, reason: "parse_error", retryable: true }
    }
    if (parsed.data.rows.length > requestedPageSize) {
      return { ok: false, reason: "parse_error", retryable: true }
    }
    pageCount += 1
    aggregation = parsed.data.responseAggregationType ?? aggregation
    firstIncompleteDate =
      parsed.data.metadata?.first_incomplete_date ?? firstIncompleteDate
    if (parsed.data.rows.length === 0) break
    const validRows = parsed.data.rows.filter(
      (row) => row.keys.length === input.dimensions.length,
    )
    if (validRows.length !== parsed.data.rows.length) {
      return { ok: false, reason: "parse_error", retryable: true }
    }
    rows.push(...validRows)
    if (parsed.data.rows.length < requestedPageSize) break
  }

  const capped = rows.length >= config.maxGscRows
  const incomplete = Boolean(firstIncompleteDate) || input.dataState !== "final"
  const retrievedAt = (input.now ?? (() => new Date()))().toISOString()
  const observation: SeoEvidenceObservation = {
    id:
      input.observationId ??
      `gsc-${createHash("sha256").update(`${input.propertyId}:${input.startDate}:${input.endDate}:${randomUUID()}`).digest("hex").slice(0, 20)}`,
    provider: "gsc",
    status: capped || incomplete ? "partial" : "available",
    retrievedAt,
    scope: {
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    data: {
      dimensions: input.dimensions,
      filters: input.filters ?? [],
      dataState: input.dataState ?? "final",
      timezone: "America/Los_Angeles",
      searchType: "web",
      configuredRowCap: config.maxGscRows,
      rowCount: rows.length,
      pageCount,
      requestCount,
      capReached: capped,
      rows,
      responseAggregationType: aggregation,
      firstIncompleteDate,
    },
    quality: {
      complete: !capped && !incomplete,
      truncated: capped,
      caveats: [
        "Search Analytics returns top rows and is not guaranteed exhaustive; an absent row is unobserved, not zero.",
        ...(capped ? ["Configured row cap reached before an empty page."] : []),
        ...(incomplete
          ? ["The requested window includes non-final Search Console data."]
          : []),
      ],
    },
    sources: [],
  }
  return {
    ok: true,
    propertyId: input.propertyId,
    rows,
    observation,
    responseAggregationType: aggregation,
    firstIncompleteDate,
  }
}
