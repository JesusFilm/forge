import type { Core } from "@strapi/strapi"
import {
  indexVideoEmbeddings,
  getVideoEmbeddingStats,
} from "../services/indexer"

const EXPECTED_DIMS = 1536
const MAX_CHUNKS = 500

type StrapiContext = {
  status: number
  body: unknown
  request: {
    body?: {
      videoId?: number
      chunks?: { text: string; embedding: number[] }[]
      model?: string
    }
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const { videoId, chunks, model } = ctx.request.body ?? {}

    if (
      typeof videoId !== "number" ||
      !Array.isArray(chunks) ||
      chunks.length === 0
    ) {
      ctx.status = 400
      ctx.body = {
        error: "videoId (number) and chunks (non-empty array) are required",
      }
      return
    }

    if (chunks.length > MAX_CHUNKS) {
      ctx.status = 400
      ctx.body = { error: `Maximum ${MAX_CHUNKS} chunks per request` }
      return
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      if (
        !chunk ||
        typeof chunk.text !== "string" ||
        !chunk.text ||
        !Array.isArray(chunk.embedding) ||
        chunk.embedding.length !== EXPECTED_DIMS ||
        !chunk.embedding.every((v) => Number.isFinite(v))
      ) {
        ctx.status = 400
        ctx.body = {
          error: `Invalid chunk at index ${i}: requires non-empty text and ${EXPECTED_DIMS} finite numbers`,
        }
        return
      }
    }

    try {
      const result = await indexVideoEmbeddings(strapi, videoId, chunks, model)
      ctx.status = 200
      ctx.body = result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("violates foreign key")) {
        ctx.status = 404
        ctx.body = { error: `Video ${videoId} not found` }
      } else {
        strapi.log.error(`[embedding] Index failed: ${message}`)
        ctx.status = 500
        ctx.body = { error: "Failed to index embeddings" }
      }
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
