import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { prisma } from "@/db/client"
import {
  sampleSearchTraces,
  type SearchTraceRouteSourceLabel,
  type SearchTraceSampleFilters,
} from "@/services/search-trace.service"
import {
  isSearchTraceAbuseLabel,
  isSearchTraceQueryQualityLabel,
  isSearchTraceSensitiveQueryLabel,
  type SearchTraceAbuseLabel,
  type SearchTraceQueryQualityLabel,
  type SearchTraceSensitiveQueryLabel,
} from "@/services/search-trace-privacy"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_SAMPLE_BODY_BYTES = 4096

function tooManyRequests(): Response {
  return Response.json({ error: "Too many requests" }, { status: 429 })
}

function unauthorized(): Response {
  return Response.json({ error: "Authorization required" }, { status: 401 })
}

function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

function unsupportedMediaType(): Response {
  return Response.json(
    { error: "Content-Type must be application/json" },
    { status: 415 },
  )
}

function payloadTooLarge(): Response {
  return Response.json({ error: "JSON body is too large" }, { status: 413 })
}

function parseDate(value: unknown, name: string): Date | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "string" || value.length === 0) {
    return badRequest(`${name} must be an ISO date string`)
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? badRequest(`${name} must be a valid date`)
    : date
}

function parseLimit(value: unknown): number | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return badRequest("limit must be a finite number")
  }
  return value
}

function parseString(
  value: unknown,
  name: string,
): string | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "string") return badRequest(`${name} must be a string`)
  return value
}

function parseLabelArray<T extends string>(
  value: unknown,
  name: string,
  isValid: (label: string) => label is T,
): T[] | Response | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) return badRequest(`${name} must be an array`)
  if (value.length === 0) return badRequest(`${name} must not be empty`)
  if (value.length > 16) return badRequest(`${name} must have at most 16 items`)

  const labels: T[] = []
  for (const item of value) {
    if (typeof item !== "string" || !isValid(item)) {
      return badRequest(`${name} contains an unsupported label`)
    }
    if (!labels.includes(item)) labels.push(item)
  }
  return labels
}

function parseLlmClassification(
  value: unknown,
): SearchTraceSampleFilters["llmClassification"] | Response | undefined {
  if (value == null) return undefined
  if (
    value === "any" ||
    value === "classified" ||
    value === "unclassified" ||
    value === "candidates"
  ) {
    return value
  }
  return badRequest(
    "llmClassification must be 'any', 'classified', 'unclassified', or 'candidates'",
  )
}

function logValue(value: string | undefined): string {
  if (value == null || value.length === 0) return "all"
  return value.replace(/[\r\n\t\s=]/g, "_").slice(0, 64)
}

async function readJsonBody(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^\s*application\/json(?:\s*;|$)/i.test(contentType)) {
    return unsupportedMediaType()
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      return badRequest("Content-Length must be a non-negative number")
    }
    if (declaredBytes > MAX_SAMPLE_BODY_BYTES) return payloadTooLarge()
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    return badRequest("Invalid JSON body")
  }
  if (new TextEncoder().encode(text).byteLength > MAX_SAMPLE_BODY_BYTES) {
    return payloadTooLarge()
  }

  try {
    return JSON.parse(text)
  } catch {
    return badRequest("Invalid JSON body")
  }
}

function parseBody(body: unknown): SearchTraceSampleFilters | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const record = body as Record<string, unknown>
  const routeSource = record.routeSource
  if (
    routeSource != null &&
    routeSource !== "rest" &&
    routeSource !== "graphql"
  ) {
    return badRequest("routeSource must be 'rest' or 'graphql'")
  }
  const locale = parseString(record.locale, "locale")
  if (locale instanceof Response) return locale
  const searchMode = parseString(record.searchMode, "searchMode")
  if (searchMode instanceof Response) return searchMode
  const queryQualityLabels = parseLabelArray<SearchTraceQueryQualityLabel>(
    record.queryQualityLabels,
    "queryQualityLabels",
    isSearchTraceQueryQualityLabel,
  )
  if (queryQualityLabels instanceof Response) return queryQualityLabels
  const sensitiveQueryLabels = parseLabelArray<SearchTraceSensitiveQueryLabel>(
    record.sensitiveQueryLabels,
    "sensitiveQueryLabels",
    isSearchTraceSensitiveQueryLabel,
  )
  if (sensitiveQueryLabels instanceof Response) return sensitiveQueryLabels
  const abuseLabels = parseLabelArray<SearchTraceAbuseLabel>(
    record.abuseLabels,
    "abuseLabels",
    isSearchTraceAbuseLabel,
  )
  if (abuseLabels instanceof Response) return abuseLabels
  const llmClassification = parseLlmClassification(record.llmClassification)
  if (llmClassification instanceof Response) return llmClassification
  const since = parseDate(record.since, "since")
  if (since instanceof Response) return since
  const until = parseDate(record.until, "until")
  if (until instanceof Response) return until
  const limit = parseLimit(record.limit)
  if (limit instanceof Response) return limit

  return {
    locale,
    routeSource: routeSource as SearchTraceRouteSourceLabel | undefined,
    searchMode,
    queryQualityLabels,
    sensitiveQueryLabels,
    abuseLabels,
    llmClassification,
    since,
    until,
    limit,
  }
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-trace-sample",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    console.warn(
      `[search] event=trace_sample_auth_denied route=internal rl=${limit.source}`,
    )
    return unauthorized()
  }

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const filters = parseBody(body)
  if (filters instanceof Response) return filters

  const traces = await sampleSearchTraces(prisma, filters)
  console.error(
    `[search] event=trace_sample auth=bearer route=internal rl=${limit.source} locale=${logValue(filters.locale)} route_source=${logValue(filters.routeSource)} search_mode=${logValue(filters.searchMode)} result_count=${traces.length}`,
  )
  return Response.json(
    {
      traces,
      generatedAt: new Date().toISOString(),
    },
    { status: 200 },
  )
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
