import type { Core } from "@strapi/strapi"
import {
  EmbeddingIndexError,
  type EmbeddingIndexMode,
  indexVideoEmbeddings,
  syncVideoEmbeddings,
  getVideoEmbeddingStats,
} from "../services/indexer"

export const EXPECTED_DIMS = 1536
export const MAX_CHUNKS = 500

type StrapiContext = {
  status: number
  body: unknown
  request: {
    headers: Record<string, string | undefined>
    body?: {
      videoId?: number
      videoDocumentId?: string
      chunks?: { text: string; embedding: number[] }[]
      model?: string
      mode?: EmbeddingIndexMode
      expectedGeneratedContentFingerprint?: string
      expectedExistingContentFingerprint?: string
    }
  }
}

function isFiniteChunkVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EXPECTED_DIMS &&
    value.every((entry) => Number.isFinite(entry))
  )
}

function validateChunks(
  chunks: { text: string; embedding: number[] }[] | undefined,
): string | null {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return "chunks (non-empty array) are required"
  }

  if (chunks.length > MAX_CHUNKS) {
    return `Maximum ${MAX_CHUNKS} chunks per request`
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (
      !chunk ||
      typeof chunk.text !== "string" ||
      !chunk.text ||
      !isFiniteChunkVector(chunk.embedding)
    ) {
      return `Invalid chunk at index ${i}: requires non-empty text and ${EXPECTED_DIMS} finite numbers`
    }
  }

  return null
}

function readBearerToken(ctx: StrapiContext): string | null {
  const authorization = ctx.request.headers["authorization"]
  if (!authorization?.startsWith("Bearer ")) {
    return null
  }

  const token = authorization.slice(7).trim()
  return token.length > 0 ? token : null
}

function enforceModeTokenScope(
  ctx: StrapiContext,
  mode: EmbeddingIndexMode,
): boolean {
  const token = readBearerToken(ctx)
  if (!token) {
    ctx.status = 401
    ctx.body = { error: "Missing or invalid Authorization header" }
    return false
  }

  if (mode === "override") {
    const internalToken = process.env.STRAPI_INTERNAL_API_TOKEN
    if (!internalToken) {
      ctx.status = 503
      ctx.body = { error: "Internal embedding override token not configured" }
      return false
    }
    if (token !== internalToken) {
      ctx.status = 403
      ctx.body = { error: "Internal API token required for embedding override" }
      return false
    }
    return true
  }

  const internalToken = process.env.STRAPI_INTERNAL_API_TOKEN
  if (!internalToken) {
    ctx.status = 503
    ctx.body = { error: "Internal embedding sync token not configured" }
    return false
  }

  if (token === internalToken) {
    return true
  }

  ctx.status = 403
  ctx.body = { error: "Internal API token required for embedding sync" }
  return false
}

function enforceLegacyWriteToken(ctx: StrapiContext): boolean {
  const token = readBearerToken(ctx)
  if (!token) {
    ctx.status = 401
    ctx.body = { error: "Missing or invalid Authorization header" }
    return false
  }

  const internalToken = process.env.STRAPI_INTERNAL_API_TOKEN
  if (!internalToken) {
    ctx.status = 503
    ctx.body = { error: "Internal embedding write token not configured" }
    return false
  }

  if (token !== internalToken) {
    ctx.status = 403
    ctx.body = { error: "Internal API token required" }
    return false
  }

  return true
}

function handleEmbeddingError(
  strapi: Core.Strapi,
  ctx: StrapiContext,
  err: unknown,
) {
  if (err instanceof EmbeddingIndexError) {
    ctx.status = err.status
    ctx.body = { error: err.code }
    return
  }

  const message = err instanceof Error ? err.message : String(err)
  if (message.includes("violates foreign key")) {
    ctx.status = 404
    ctx.body = { error: "video_not_found" }
    return
  }

  strapi.log.error(`[embedding] Index failed: ${message}`)
  ctx.status = 500
  ctx.body = { error: "Failed to index embeddings" }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const {
      videoId,
      videoDocumentId,
      chunks,
      model,
      mode,
      expectedGeneratedContentFingerprint,
      expectedExistingContentFingerprint,
    } = ctx.request.body ?? {}

    if (mode == null) {
      if (!enforceLegacyWriteToken(ctx)) {
        return
      }

      const chunkValidation = validateChunks(chunks)
      if (typeof videoId !== "number" || chunkValidation) {
        ctx.status = 400
        ctx.body = {
          error:
            typeof videoId !== "number"
              ? "videoId (number) and chunks (non-empty array) are required"
              : chunkValidation,
        }
        return
      }

      try {
        const result = await indexVideoEmbeddings(
          strapi,
          videoId,
          chunks,
          model,
        )
        ctx.status = 200
        ctx.body = result
      } catch (err) {
        handleEmbeddingError(strapi, ctx, err)
      }
      return
    }

    if (!enforceModeTokenScope(ctx, mode)) {
      return
    }

    if (mode !== "inspect" && mode !== "if_missing" && mode !== "override") {
      ctx.status = 400
      ctx.body = { error: "mode must be inspect, if_missing, or override" }
      return
    }

    if (
      typeof videoId !== "number" &&
      (typeof videoDocumentId !== "string" ||
        videoDocumentId.trim().length === 0)
    ) {
      ctx.status = 400
      ctx.body = { error: "videoId or videoDocumentId is required" }
      return
    }

    if (mode !== "inspect") {
      const chunkValidation = validateChunks(chunks)
      if (chunkValidation) {
        ctx.status = 400
        ctx.body = { error: chunkValidation }
        return
      }
    }

    if (
      mode === "override" &&
      (typeof expectedGeneratedContentFingerprint !== "string" ||
        expectedGeneratedContentFingerprint.trim().length === 0 ||
        typeof expectedExistingContentFingerprint !== "string" ||
        expectedExistingContentFingerprint.trim().length === 0)
    ) {
      ctx.status = 400
      ctx.body = {
        error:
          "expectedGeneratedContentFingerprint and expectedExistingContentFingerprint are required for override",
      }
      return
    }

    try {
      const result = await syncVideoEmbeddings(strapi, {
        videoId,
        videoDocumentId,
        chunks,
        model,
        mode,
        expectedGeneratedContentFingerprint,
        expectedExistingContentFingerprint,
      })
      ctx.status = 200
      ctx.body = result
    } catch (err) {
      handleEmbeddingError(strapi, ctx, err)
    }
  },

  async stats(ctx: StrapiContext) {
    try {
      const result = await getVideoEmbeddingStats(strapi)
      ctx.status = 200
      ctx.body = result
    } catch {
      ctx.status = 503
      ctx.body = { error: "Embedding features not available" }
    }
  },
})
