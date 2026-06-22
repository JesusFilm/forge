/**
 * Shared plumbing for the bearer-gated agent-tool routes (consolidation U7).
 *
 * Mirrors the search-eval internal route's posture: rate-limit FIRST (so junk
 * Authorization headers can't bypass the per-IP bucket — bearer-as-passport
 * learning), THEN the dedicated `ADMIN_AGENT_TOOLS_API_KEYS` bearer, THEN a
 * size-capped JSON body read, THEN the per-route handler. The handler is
 * wrapped so a thrown service error degrades to a 503 with a plain-string log
 * (Railway logsV2 silences JSON.stringify payloads from this runtime path)
 * rather than leaking a stack to the caller.
 *
 * This is NOT a Next.js route file — it exports helpers consumed by the three
 * sibling `route.ts` handlers.
 */

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidAgentToolsBearer } from "@/auth/agent-tools-bearer"

const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 4096

export function tooManyRequests(): Response {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "retry-after": "60" } },
  )
}

export function unauthorized(): Response {
  return Response.json({ error: "Authorization required" }, { status: 401 })
}

export function badRequest(error: string): Response {
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
    { error: "Agent tool is temporarily unavailable" },
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

  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return badRequest("Invalid JSON body")
  }
}

/**
 * Build a POST handler for an agent-tool route: rate-limit → bearer → JSON body
 * → per-route `handle(body)`. A thrown error from `handle` degrades to 503.
 */
export function agentToolRoute(
  routeKey: string,
  handle: (body: unknown) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const limit = await rateLimitAuthRoute({
      request,
      route: routeKey,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
    if (!limit.allowed) return tooManyRequests()

    if (!isValidAgentToolsBearer(request.headers.get("authorization"))) {
      console.warn(
        `[agent-tools] event=auth_denied route=${routeKey} rl=${limit.source}`,
      )
      return unauthorized()
    }

    const body = await readJsonBody(request)
    if (body instanceof Response) return body

    try {
      return await handle(body)
    } catch (error) {
      console.error(
        `[agent-tools] event=handler_failed route=${routeKey} error_class=${
          error instanceof Error ? error.name : typeof error
        }`,
      )
      return serviceUnavailable()
    }
  }
}
