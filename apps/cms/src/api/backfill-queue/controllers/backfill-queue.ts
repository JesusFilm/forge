import type { Core } from "@strapi/strapi"
import { fetchBackfillQueue } from "../services/backfill-queue"

type StrapiContext = {
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async queue(ctx: StrapiContext) {
    try {
      const videos = await fetchBackfillQueue(strapi)
      ctx.status = 200
      ctx.body = { videos, total: videos.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      strapi.log.error(`[backfill-queue] Query failed: ${message}`)
      ctx.status = 500
      ctx.body = { error: "Failed to fetch backfill queue" }
    }
  },
})
