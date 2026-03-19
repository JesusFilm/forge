import { runFullSync, getSyncStatus } from "../services/gateway-sync"

export default {
  async trigger(ctx: { status: number; body: unknown }) {
    // Fire and forget — sync runs in background
    runFullSync(strapi).catch((error) => {
      strapi.log.error(
        `[gateway-sync] Background sync failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: "Gateway sync started",
      status: getSyncStatus(),
    }
  },

  async status(ctx: { body: unknown }) {
    ctx.body = getSyncStatus()
  },
}
