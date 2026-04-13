import type { Core } from "@strapi/strapi"
import {
  queryHierarchyGraph,
  querySceneSimilarityGraph,
  queryTagsGraph,
  queryVideoSimilarityGraph,
} from "../services/graph"

type StrapiContext = {
  status: number
  body: unknown
  query: Record<string, string | undefined>
}

function parseIntParam(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseFloatParam(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async hierarchy(ctx: StrapiContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection
    const originId = ctx.query.originId
    const limit = parseIntParam(ctx.query.limit, 2000)
    const payload = await queryHierarchyGraph(knex, { originId, limit })
    ctx.status = 200
    ctx.body = payload
  },

  async sceneSimilarity(ctx: StrapiContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection
    const limit = parseIntParam(ctx.query.limit, 500)
    const knn = parseIntParam(ctx.query.knn, 5)
    const threshold = parseFloatParam(ctx.query.threshold, 0.75)
    const videoId = ctx.query.videoId
      ? Number.parseInt(ctx.query.videoId, 10)
      : undefined
    const payload = await querySceneSimilarityGraph(knex, {
      limit,
      knn,
      threshold,
      videoId: Number.isFinite(videoId) ? videoId : undefined,
    })
    ctx.status = 200
    ctx.body = payload
  },

  async videoSimilarity(ctx: StrapiContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection
    const limit = parseIntParam(ctx.query.limit, 500)
    const knn = parseIntParam(ctx.query.knn, 5)
    const threshold = parseFloatParam(ctx.query.threshold, 0.75)
    const payload = await queryVideoSimilarityGraph(knex, {
      limit,
      knn,
      threshold,
    })
    ctx.status = 200
    ctx.body = payload
  },

  async tags(ctx: StrapiContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection
    const bcp47 = ctx.query.bcp47 ?? "en-US"
    const limit = parseIntParam(ctx.query.limit, 1500)
    const payload = await queryTagsGraph(knex, { bcp47, limit })
    ctx.status = 200
    ctx.body = payload
  },
})
