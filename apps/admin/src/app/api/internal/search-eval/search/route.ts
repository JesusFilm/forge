import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { prisma } from "@/db/client"
import {
  HybridSearchService,
  isContentType,
  type ContentType,
} from "@/services/hybrid-search.service"

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 4096
const MAX_QUERY_LENGTH = 1024
const MAX_LOCALE_LENGTH = 32
const MAX_LANGUAGE_SLUG_LENGTH = 128
const BCP47_REGEX = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const LANGUAGE_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

function parseInteger(
  value: unknown,
  name: string,
): number | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return badRequest(`${name} must be an integer`)
  }
  return value
}

function parseString(
  value: unknown,
  name: string,
): string | Response | undefined {
  if (value == null) return undefined
  if (typeof value !== "string") return badRequest(`${name} must be a string`)
  const normalized = value.trim()
  return normalized.length === 0
    ? badRequest(`${name} must not be empty`)
    : normalized
}

function parseBody(body: unknown):
  | {
      query: string
      locale: string
      limit?: number
      offset?: number
      mode?: string
      languageSlug?: string
      contentTypes?: ContentType[]
    }
  | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const record = body as Record<string, unknown>
  const query = parseString(record.query, "query")
  if (query instanceof Response) return query
  if (query == null || query.length > MAX_QUERY_LENGTH) {
    return badRequest(`query must be at most ${MAX_QUERY_LENGTH} characters`)
  }
  const locale = parseString(record.locale, "locale")
  if (locale instanceof Response) return locale
  if (locale == null) return badRequest("locale is required")
  if (locale.length > MAX_LOCALE_LENGTH || !BCP47_REGEX.test(locale)) {
    return badRequest("locale must be a safe BCP-47 tag")
  }

  const languageSlug = parseString(record.languageSlug, "languageSlug")
  if (languageSlug instanceof Response) return languageSlug
  if (
    languageSlug != null &&
    (languageSlug.length > MAX_LANGUAGE_SLUG_LENGTH ||
      !LANGUAGE_SLUG_REGEX.test(languageSlug))
  ) {
    return badRequest("languageSlug must be a safe public language slug")
  }

  const limit = parseInteger(record.limit, "limit")
  if (limit instanceof Response) return limit
  if (limit != null && (limit <= 0 || limit > 50)) {
    return badRequest("limit must be between 1 and 50")
  }
  const offset = parseInteger(record.offset, "offset")
  if (offset instanceof Response) return offset
  if (offset != null && offset < 0) {
    return badRequest("offset must be at least 0")
  }

  const mode = parseString(record.mode, "mode")
  if (mode instanceof Response) return mode

  const contentType = parseString(record.contentType, "contentType")
  if (contentType instanceof Response) return contentType
  if (contentType != null && !isContentType(contentType)) {
    return badRequest("contentType must be 'video' or 'experience'")
  }

  return {
    query,
    locale,
    limit,
    offset,
    mode,
    languageSlug,
    contentTypes: contentType ? [contentType] : undefined,
  }
}

async function searchLocaleForParams(params: {
  locale: string
  languageSlug?: string
}): Promise<string | Response> {
  if (!params.languageSlug) return params.locale

  const language = await prisma.language.findFirst({
    where: { slug: params.languageSlug, deletedAt: null },
    select: { bcp47: true },
  })
  const bcp47 = language?.bcp47?.trim()
  if (!bcp47 || bcp47.length > MAX_LOCALE_LENGTH || !BCP47_REGEX.test(bcp47)) {
    return badRequest("languageSlug must reference a searchable language")
  }
  return bcp47
}

function logValue(value: string | undefined): string {
  if (value == null || value.length === 0) return "none"
  return value.replace(/[\r\n\t\s=]/g, "_").slice(0, 64)
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-eval-search",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    console.warn(
      `[search] event=eval_search_auth_denied route=internal rl=${limit.source}`,
    )
    return unauthorized()
  }

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const params = parseBody(body)
  if (params instanceof Response) return params

  try {
    const locale = await searchLocaleForParams(params)
    if (locale instanceof Response) return locale
    const service = new HybridSearchService({ prisma })
    const response = await service.search({
      query: params.query,
      locale,
      limit: params.limit,
      offset: params.offset,
      mode: params.mode,
      contentTypes: params.contentTypes,
    })
    console.info(
      `[search] event=eval_search auth=bearer route=internal rl=${limit.source} locale=${logValue(locale)} mode=${logValue(params.mode)} result_count=${response.results.length}`,
    )
    return Response.json(response, { status: 200 })
  } catch (error) {
    console.error(
      `[search] event=eval_search_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return Response.json(
      { error: "Search is temporarily unavailable" },
      { status: 503 },
    )
  }
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
