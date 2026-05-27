import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { prisma } from "@/db/client"
import {
  SearchEvalCandidateStoreError,
  storeSearchEvalCandidates,
  type StoreSearchEvalCandidateInput,
} from "@/services/search-eval/candidates"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024
const MAX_CANDIDATES = 100

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

  let text: string
  try {
    text = await request.text()
  } catch {
    return badRequest("Invalid JSON body")
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return payloadTooLarge()
  }

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
    console.error(
      `[search] event=eval_candidate_store auth=bearer route=internal rl=${limit.source} stored_count=${result.storedCount} skipped_count=${result.skippedCount} mastra_run_id=${logValue(parsed.candidates[0]?.mastraRunId ?? undefined)}`,
    )
    return Response.json(result, { status: 200 })
  } catch (error) {
    if (error instanceof SearchEvalCandidateStoreError) {
      return badRequest(error.message)
    }
    throw error
  }
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
