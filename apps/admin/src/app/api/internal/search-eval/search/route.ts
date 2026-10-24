import { z } from "zod"

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isValidSearchTraceSamplingBearer } from "@/auth/search-trace-bearer"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { enqueueWatchSearchTrace } from "@/services/search-trace.service"
import {
  createTypesenseWatchSearchService,
  TypesenseWatchSearchUnavailableError,
} from "@/services/typesense-watch-search.service"
import { canonicalTypesenseVideoId } from "@/services/typesense-watch-search-identifiers"
import {
  WatchSearchService,
  WatchSearchValidationError,
  type WatchSearchInput,
} from "@/services/watch-search.service"

const RATE_LIMIT_MAX = 300
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 4_096

const SearchEvalInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(1).max(32),
    languageSlug: z.string().trim().min(1).max(128).optional(),
    clientRequestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,80}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
    mode: z
      .enum(["modern", "default", "hybrid", "keyword-first", "semantic-only"])
      .default("modern"),
    contentType: z.enum(["video", "experience"]).nullable().optional(),
  })
  .strict()

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

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "search-eval-search",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return jsonError("Too many requests", 429, { "retry-after": "60" })
  }
  if (!isValidSearchTraceSamplingBearer(request.headers.get("authorization"))) {
    return jsonError("Authorization required", 401)
  }

  const body = await readBoundedJson(request)
  if (body instanceof Response) return body
  const parsed = SearchEvalInputSchema.safeParse(body)
  if (!parsed.success) return jsonError("Invalid search eval input", 400)

  const routeInput = parsed.data
  const mode = routeInput.mode === "modern" ? "modern" : "default"
  const input: WatchSearchInput = {
    query: routeInput.query,
    mode,
    clientRequestId: routeInput.clientRequestId,
    targetLanguageSlug: routeInput.languageSlug,
    queryLanguageSlug: routeInput.languageSlug,
    displayLanguageSlug: routeInput.languageSlug,
    routeLanguageSlug: routeInput.languageSlug,
    limit: routeInput.limit,
    offset: routeInput.offset,
    resultTypes: resultTypesFor(routeInput.contentType),
  }
  const startedAt = new Date()

  try {
    const service =
      mode === "modern"
        ? createTypesenseWatchSearchService(prisma)
        : new WatchSearchService(prisma)
    if (service == null) throw new TypesenseWatchSearchUnavailableError()
    const response = await service.search(input)
    enqueueWatchSearchTrace(
      {
        input,
        response,
        startedAt,
        completedAt: new Date(),
      },
      prisma,
    )

    const videoIds = response.results
      .filter((result) => result.type === "video")
      .map((result) => result.id)
    const videos = await prisma.video.findMany({
      where: { id: { in: videoIds } },
      select: { id: true, coreId: true },
    })
    const canonicalByVideoId = new Map(
      videos.map((video) => [
        video.id,
        canonicalTypesenseVideoId(video.id, video.coreId),
      ]),
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
      revision: env.NEXT_PUBLIC_DATADOG_VERSION ?? null,
      laneStatuses: response.laneStatuses,
    })
  } catch (error) {
    if (error instanceof WatchSearchValidationError) {
      return jsonError(error.message, 400)
    }
    if (error instanceof TypesenseWatchSearchUnavailableError) {
      return jsonError("MODERN search is unavailable", 503)
    }
    return jsonError("Search eval is temporarily unavailable", 503)
  }
}
