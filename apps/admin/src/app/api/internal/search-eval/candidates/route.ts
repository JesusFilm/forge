import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { prisma } from "@/db/client"
import {
  SearchEvalCandidateStoreError,
  listSearchEvalCandidates,
  storeSearchEvalCandidates,
  type ListSearchEvalCandidatesFilters,
  type SearchEvalCandidateSourceLabel,
  type StoreSearchEvalCandidateInput,
} from "@/services/search-eval/candidates"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024
const MAX_CANDIDATES = 100

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
    { error: "Candidate storage is temporarily unavailable" },
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

function parseBody(
  body: unknown,
): { candidates: StoreSearchEvalCandidateInput[] } | Response {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("JSON body must be an object")
  }
  const candidates = (body as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) {
    return badRequest("candidates must be an array")
  }
  if (candidates.length === 0) {
    return badRequest("candidates must not be empty")
  }
  if (candidates.length > MAX_CANDIDATES) {
    return badRequest(`candidates must have at most ${MAX_CANDIDATES} items`)
  }
  for (const candidate of candidates) {
    if (
      candidate == null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return badRequest("each candidate must be an object")
    }
    if ("promotionStatus" in candidate) {
      return badRequest("promotionStatus is server-owned")
    }
  }
  return { candidates: candidates as StoreSearchEvalCandidateInput[] }
}

function logValue(value: string | undefined): string {
  if (value == null || value.length === 0) return "none"
  return value.replace(/[\r\n\t\s=]/g, "_").slice(0, 64)
}

function parsePositiveInteger(
  value: string | null,
  name: string,
): number | Response | undefined {
  if (value == null || value.length === 0) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return badRequest(`${name} must be a positive integer`)
  }
  return parsed
}

function parseCsv(value: string | null): string[] | undefined {
  if (value == null || value.trim().length === 0) return undefined
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseSources(
  value: string | null,
): SearchEvalCandidateSourceLabel[] | Response | undefined {
  const values = parseCsv(value)
  if (values == null) return undefined
  const sources: SearchEvalCandidateSourceLabel[] = []
  for (const source of values) {
    if (
      source !== "catalog" &&
      source !== "locale_quality" &&
      source !== "trace"
    ) {
      return badRequest("source must be catalog, locale_quality, or trace")
    }
    if (!sources.includes(source)) sources.push(source)
  }
  return sources
}

function parseListFilters(
  request: Request,
): ListSearchEvalCandidatesFilters | Response {
  const { searchParams } = new URL(request.url)
  const limit = parsePositiveInteger(searchParams.get("limit"), "limit")
  if (limit instanceof Response) return limit
  if (limit != null && limit > 100) {
    return badRequest("limit must be at most 100")
  }
  const sources = parseSources(searchParams.get("source"))
  if (sources instanceof Response) return sources
  const locales = parseCsv(searchParams.get("locale"))
  if (locales != null && locales.length > 30) {
    return badRequest("locale must contain at most 30 values")
  }
  const mastraRunId = searchParams.get("mastraRunId")

  return {
    limit,
    sources,
    locales,
    mastraRunId,
  }
}

type ListedCandidateResponse = Awaited<
  ReturnType<typeof listSearchEvalCandidates>
>[number]

function sanitizeCandidateForResponse(
  candidate: ListedCandidateResponse,
): ListedCandidateResponse {
  if (candidate.source !== "trace") return candidate
  return {
    ...candidate,
    queryText: null,
    expectedResultHints: [],
    sourceAnchors: [],
    labelProvenance: { source: "trace", redacted: true },
    generationModel: "trace:redacted",
    generationProvider: null,
    judgeSummary: null,
    mastraRunId: null,
  }
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-eval-candidates",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    console.warn(
      `[search] event=eval_candidate_auth_denied route=internal rl=${limit.source}`,
    )
    return unauthorized()
  }

  const body = await readJsonBody(request)
  if (body instanceof Response) return body

  const parsed = parseBody(body)
  if (parsed instanceof Response) return parsed

  try {
    const result = await storeSearchEvalCandidates(prisma, parsed.candidates)
    console.info(
      `[search] event=eval_candidate_store auth=bearer route=internal rl=${limit.source} stored_count=${result.storedCount} skipped_count=${result.skippedCount} mastra_run_id=${logValue(parsed.candidates[0]?.mastraRunId ?? undefined)}`,
    )
    return Response.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof SearchEvalCandidateStoreError) {
      return badRequest(error.message)
    }
    console.error(
      `[search] event=eval_candidate_store_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}

export async function GET(request?: Request): Promise<Response> {
  if (!request) return unauthorized()

  const limit = await rateLimitAuthRoute({
    request,
    route: "search-eval-candidates",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return tooManyRequests()

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    console.warn(
      `[search] event=eval_candidate_read_auth_denied route=internal rl=${limit.source}`,
    )
    return unauthorized()
  }

  const filters = parseListFilters(request)
  if (filters instanceof Response) return filters

  try {
    const candidates = await listSearchEvalCandidates(prisma, filters)
    console.info(
      `[search] event=eval_candidate_read auth=bearer route=internal rl=${limit.source} source=${logValue(filters.sources?.join(","))} locale=${logValue(filters.locales?.join(","))} result_count=${candidates.length}`,
    )
    return Response.json(
      {
        candidates: candidates.map(sanitizeCandidateForResponse),
        generatedAt: new Date().toISOString(),
      },
      { status: 200 },
    )
  } catch (error) {
    if (error instanceof SearchEvalCandidateStoreError) {
      return badRequest(error.message)
    }
    console.error(
      `[search] event=eval_candidate_read_failed route=internal error_class=${logValue(error instanceof Error ? error.name : typeof error)}`,
    )
    return serviceUnavailable()
  }
}
