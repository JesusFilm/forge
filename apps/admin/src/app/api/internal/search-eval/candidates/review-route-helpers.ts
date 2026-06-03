import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { SearchEvalCandidateStoreError } from "@/services/search-eval-candidates"

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024

export function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

export function serviceUnavailable(): Response {
  return Response.json(
    { error: "Candidate review is temporarily unavailable" },
    { status: 503 },
  )
}

export function responseForCandidateError(error: unknown): Response | null {
  if (!(error instanceof SearchEvalCandidateStoreError)) return null
  if (error.code === "not_found") {
    return Response.json({ error: error.message }, { status: 404 })
  }
  if (error.code === "invalid_state") {
    return Response.json({ error: error.message }, { status: 409 })
  }
  return badRequest(error.message)
}

export function logValue(value: string | undefined): string {
  if (value == null || value.length === 0) return "none"
  return value.replace(/[\r\n\t\s=]/g, "_").slice(0, 64)
}

export async function authorizeSearchEvalCandidateRequest(
  request: Request,
  route: string,
): Promise<{ rateLimitSource: string } | Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": "60" } },
    )
  }

  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    return Response.json({ error: "Authorization required" }, { status: 401 })
  }

  return { rateLimitSource: limit.source }
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

export async function readJsonBody(
  request: Request,
): Promise<unknown | Response> {
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

  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return badRequest("Invalid JSON body")
  }
}
