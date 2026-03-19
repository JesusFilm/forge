import type { Core } from "@strapi/strapi"
import { runSync, resolveScope, getSyncStatus } from "../services/gateway-sync"

type StrapiContext = {
  request: { body?: { scope?: string | string[] } }
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    const scope = ctx.request.body?.scope
    const phases = resolveScope(scope)

    // Fire and forget — sync runs in background
    runSync(strapi, scope).catch((error) => {
      strapi.log.error(
        `[gateway-sync] Background sync failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: `Gateway sync started`,
      phases,
      status: getSyncStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSyncStatus()
  },
})
