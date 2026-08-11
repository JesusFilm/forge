import { createHash } from "node:crypto"

import { z } from "zod"

import { isValidCandidateSearchEvalBearer } from "@/auth/candidate-search-eval-bearer"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { projectWatchSearchComparisonResult } from "@/services/search-trace-privacy"
import { createTypesenseWatchSearchComparisonService } from "@/services/typesense-watch-search-comparison.service"
import type { WatchSearchInput } from "@/services/watch-search.service"

const MAX_BODY_BYTES = 4_096
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

const CandidateCompareInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(1).max(32).optional(),
    languageSlug: z.string().trim().min(1).max(128).optional(),
    acceptLanguage: z.string().trim().min(1).max(512).optional(),
    displayLanguageSlug: z.string().trim().min(1).max(128).optional(),
    routeLanguageSlug: z.string().trim().min(1).max(128).optional(),
    currentWatchLanguageSlug: z.string().trim().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
    contentType: z.enum(["video", "experience"]).nullable().optional(),
  })
  .strict()

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers })
}

async function readBoundedJson(request: Request): Promise<unknown | Response> {
  if (
    !/^\s*application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return jsonError("Content-Type must be application/json", 415)
  }
  const declared = request.headers.get("content-length")
  if (declared != null && Number(declared) > MAX_BODY_BYTES) {
    return jsonError("JSON body is too large", 413)
  }
  if (!request.body) return jsonError("Invalid JSON body", 400)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    let read: ReadableStreamReadResult<Uint8Array>
    try {
      read = await reader.read()
    } catch {
      return jsonError("Invalid JSON body", 400)
    }
    const { done, value } = read
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return jsonError("JSON body is too large", 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
}

function actorKey(authorization: string): string {
  return createHash("sha256").update(authorization).digest("hex").slice(0, 32)
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "candidate-search-eval-compare",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return jsonError("Too many requests", 429, { "retry-after": "60" })
  }

  const authorization = request.headers.get("authorization")
  if (!isValidCandidateSearchEvalBearer(authorization)) {
    return jsonError("Authorization required", 401)
  }

  const body = await readBoundedJson(request)
  if (body instanceof Response) return body
  const parsed = CandidateCompareInputSchema.safeParse(body)
  if (!parsed.success) return jsonError("Invalid comparison input", 400)

  const routeInput = parsed.data
  const input: WatchSearchInput = {
    query: routeInput.query,
    targetLanguageSlug: routeInput.languageSlug,
    displayLanguageSlug:
      routeInput.displayLanguageSlug ?? routeInput.languageSlug,
    routeLanguageSlug: routeInput.routeLanguageSlug,
    currentWatchLanguageSlug: routeInput.currentWatchLanguageSlug,
    acceptLanguage: routeInput.acceptLanguage ?? routeInput.locale,
    limit: routeInput.limit,
    offset: routeInput.offset,
    resultTypes:
      routeInput.contentType == null ? undefined : [routeInput.contentType],
  }

  try {
    const result = await createTypesenseWatchSearchComparisonService().compare({
      actorKey: actorKey(authorization!),
      input,
    })
    return Response.json(projectWatchSearchComparisonResult(result))
  } catch {
    return jsonError("Candidate comparison is temporarily unavailable", 503)
  }
}
