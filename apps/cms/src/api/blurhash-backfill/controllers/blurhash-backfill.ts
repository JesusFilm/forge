import type { Core } from "@strapi/strapi"
import { runBackfill, getBackfillStatus } from "../services/blurhash-backfill"

type StrapiContext = {
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    const currentStatus = getBackfillStatus()
    if (currentStatus.running) {
      ctx.status = 409
      ctx.body = {
        error: "Backfill is already running",
        status: currentStatus,
      }
      return
    }

    // Fire and forget
    runBackfill(strapi).catch((error) => {
      strapi.log.error(
        `[blurhash-backfill] Background backfill failed: ${error}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: "Blurhash backfill started",
      status: getBackfillStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getBackfillStatus()
  },
})
