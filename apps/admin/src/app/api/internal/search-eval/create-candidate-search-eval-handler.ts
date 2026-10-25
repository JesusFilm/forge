import { z } from "zod"

import { isValidCandidateSearchEvalBearer } from "@/auth/candidate-search-eval-bearer"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { prisma } from "@/db/client"
import {
  createTypesenseWatchSearchCandidateEvaluationService,
  type CandidateSearchEvaluationSource,
} from "@/services/typesense-watch-search-candidate-evaluation.service"
import { canonicalTypesenseVideoId } from "@/services/typesense-watch-search-identifiers"
import {
  WatchSearchValidationError,
  type WatchSearchInput,
} from "@/services/watch-search.service"

const RATE_LIMIT_MAX = 300
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 4_096

export type CandidateSearchEvalRouteInput = {
  query: string
  locale: string
  languageSlug?: string
  clientRequestId?: string
  limit?: number
  offset?: number
  mode: string
  contentType?: "video" | "experience" | null
}

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers })
}

async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^\s*application\/json(?:\s*;|$)/i.test(contentType)) {
    return jsonError("Content-Type must be application/json", 415)
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      return jsonError("Invalid Content-Length", 400)
    }
    if (declaredBytes > MAX_BODY_BYTES) {
      return jsonError("JSON body is too large", 413)
    }
  }

  if (request.body == null) return jsonError("Invalid JSON body", 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return jsonError("JSON body is too large", 413)
      }
      chunks.push(value)
    }
  } catch {
    return jsonError("Invalid JSON body", 400)
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
    return jsonError("Invalid JSON body", 400)
  }
}

function resultTypesFor(
  contentType: "video" | "experience" | null | undefined,
): WatchSearchInput["resultTypes"] {
  return contentType == null ? undefined : [contentType]
}

async function canonicalIdsByVideoId(videoIds: readonly string[]) {
  if (videoIds.length === 0) return new Map<string, string>()
  const videos = await prisma.video.findMany({
    where: { id: { in: [...videoIds] } },
    select: { id: true, coreId: true },
  })
  return new Map(
    videos.map((video) => [
      video.id,
      canonicalTypesenseVideoId(video.id, video.coreId),
    ]),
  )
}

export function createCandidateSearchEvalPostHandler(input: {
  source: CandidateSearchEvaluationSource
  schema: z.ZodType<CandidateSearchEvalRouteInput>
  rateLimitRoute: string
  invalidInputError: string
  unavailableError: string
}) {
  return async function POST(request: Request): Promise<Response> {
    const limit = await rateLimitAuthRoute({
      request,
      route: input.rateLimitRoute,
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
    if (!limit.allowed) {
      return jsonError("Too many requests", 429, { "retry-after": "60" })
    }
    if (
      !isValidCandidateSearchEvalBearer(request.headers.get("authorization"))
    ) {
      return jsonError("Authorization required", 401)
    }

    const body = await readBoundedJson(request)
    if (body instanceof Response) return body
    const parsed = input.schema.safeParse(body)
    if (!parsed.success) return jsonError(input.invalidInputError, 400)

    const routeInput = parsed.data
    const searchInput: WatchSearchInput = {
      query: routeInput.query,
      mode: "modern",
      clientRequestId: routeInput.clientRequestId,
      targetLanguageSlug: routeInput.languageSlug,
      queryLanguageSlug: routeInput.languageSlug,
      displayLanguageSlug: routeInput.languageSlug,
      routeLanguageSlug: routeInput.languageSlug,
      acceptLanguage: routeInput.locale,
      limit: routeInput.limit,
      offset: routeInput.offset,
      resultTypes: resultTypesFor(routeInput.contentType),
    }

    try {
      const { response, revision } =
        await createTypesenseWatchSearchCandidateEvaluationService(
          input.source,
        ).search(searchInput)
      const canonicalByVideoId = await canonicalIdsByVideoId(
        response.results
          .filter((result) => result.type === "video")
          .map((result) => result.id),
      )

      return Response.json({
        results: response.results.map((result) => ({
          type: result.type,
          id: result.id,
          slug: result.slug,
          title: result.title,
          imageUrl: result.imageUrl,
          snippet: result.snippet ?? result.description ?? "",
          startSeconds: result.startSeconds,
          playbackId: result.playbackId,
          score: result.score,
          label: result.label,
          durationSeconds: result.durationSeconds,
          childCount: result.childCount,
          ...(result.type === "video" && canonicalByVideoId.has(result.id)
            ? { canonicalVideoId: canonicalByVideoId.get(result.id) }
            : {}),
          languageSlug: result.languageSlug,
        })),
        hasMore: response.hasMore,
        query: response.query,
        searchMode: response.searchMode,
        requestId: response.requestId,
        degraded: response.degraded,
        latencyMs: response.latencyMs,
        revision,
        laneStatuses: response.laneStatuses,
      })
    } catch (error) {
      if (error instanceof WatchSearchValidationError) {
        return jsonError(error.message, 400)
      }
      return jsonError(input.unavailableError, 503)
    }
  }
}
