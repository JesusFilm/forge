import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { prisma } from "@/db/client"
import {
  SearchEvalCatalogContextError,
  readSearchEvalCatalogContext,
  type SearchEvalCatalogContextFilters,
} from "@/services/search-eval-catalog-context"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 4096

function tooManyRequests(): Response {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "retry-after": "60" } },
  )
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

function serviceUnavailable(): Response {
  return Response.json(
    { error: "Catalog context is temporarily unavailable" },
    { status: 503 },
  )
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
    if (declaredBytes > MAX_BODY_BYTES) return payloadTooLarge()
  }

  const body = request.body
  if (body == null) return badRequest("Invalid JSON body")

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return payloadTooLarge()
      }
      chunks.push(value)
    }
  } catch {
    return badRequest("Invalid JSON body")
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)

  try {
    return JSON.parse(text)
  } catch {
    return badRequest("Invalid JSON body")
  }
}

function parseLimit(value: unknown): number | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return badRequest("limit must be a finite number")
  }
  return value
}

function parseLocales(value: unknown): string[] | Response | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) return badRequest("locales must be an array")
  if (value.length === 0) return badRequest("locales must not be empty")
  if (value.length > 30) return badRequest("locales must have at most 30 items")

  const locales: string[] = []
  for (const item of value) {
    if (typeof item !== "string") {
      return badRequest("locales must contain strings")
    }
    if (!locales.includes(item)) locales.push(item)
  }
  return locales
}

function parseBody(body: unknown): SearchEvalCatalogContextFilters | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const record = body as Record<string, unknown>
  const locales = parseLocales(record.locales)
  if (locales instanceof Response) return locales
  const limit = parseLimit(record.limit)
  if (limit instanceof Response) return limit
  return { locales, limit }
}

function logValue(value: string | undefined): string {
  if (value == null || value.length === 0) return "all"
  return value.replace(/[\r\n\t\s=]/g, "_").slice(0, 64)
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-eval-catalog-context",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    console.warn(
      `[search] event=eval_catalog_context_auth_denied route=internal rl=${limit.source}`,
    )
    return unauthorized()
  }

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const filters = parseBody(body)
  if (filters instanceof Response) return filters

  try {
    const context = await readSearchEvalCatalogContext(prisma, filters)
    console.info(
      `[search] event=eval_catalog_context auth=bearer route=internal rl=${limit.source} locales=${logValue(filters.locales?.join(","))} anchor_count=${context.anchors.length}`,
    )
    return Response.json(
      {
        ...context,
        generatedAt: new Date().toISOString(),
      },
      { status: 200 },
    )
  } catch (error) {
    if (error instanceof SearchEvalCatalogContextError) {
      return badRequest(error.message)
    }
    console.error(
      `[search] event=eval_catalog_context_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
