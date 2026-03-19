import type { Core } from "@strapi/strapi"
import { runFullSync, getSyncStatus } from "../services/gateway-sync"

type StrapiContext = {
  strapi: Core.Strapi
  status: number
  body: unknown
}

export default {
  async trigger(ctx: StrapiContext) {
    // Fire and forget — sync runs in background
    runFullSync(ctx.strapi).catch((error) => {
      ctx.strapi.log.error(
        `[gateway-sync] Background sync failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: "Gateway sync started",
      status: getSyncStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSyncStatus()
  },
}
