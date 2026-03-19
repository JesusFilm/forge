import type { Core } from "@strapi/strapi"
import {
  type SyncScope,
  runSync,
  getSyncStatus,
} from "../services/gateway-sync"

type StrapiContext = {
  request: { body?: { scope?: string } }
  status: number
  body: unknown
}

const VALID_SCOPES: SyncScope[] = [
  "all",
  "languages",
  "countries",
  "videos",
  "video-variants",
]

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    const requestedScope = (ctx.request.body?.scope ?? "all") as string
    const scope: SyncScope = VALID_SCOPES.includes(requestedScope as SyncScope)
      ? (requestedScope as SyncScope)
      : "all"

    // Fire and forget — sync runs in background
    runSync(strapi, scope).catch((error) => {
      strapi.log.error(
        `[gateway-sync] Background sync failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: `Gateway sync started (scope: ${scope})`,
      validScopes: VALID_SCOPES,
      status: getSyncStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSyncStatus()
  },
})
