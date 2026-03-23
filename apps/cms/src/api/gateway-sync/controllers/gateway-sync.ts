import type { Core } from "@strapi/strapi"
import { runSync, resolveScope, getSyncStatus } from "../services/gateway-sync"
import { formatError } from "../services/strapi-helpers"

type TriggerBody = {
  scope?: string | string[]
  collectionIds?: string[]
  videoIds?: string[]
  dryRun?: boolean
}

type StrapiContext = {
  request: { body?: TriggerBody }
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    const { scope, collectionIds, videoIds, dryRun } = ctx.request.body ?? {}
    const phases = resolveScope(scope)

    const options = { scope, collectionIds, videoIds, dryRun }
    const isLimited =
      (collectionIds && collectionIds.length > 0) ||
      (videoIds && videoIds.length > 0)

    // Dry-run requests are synchronous — return the resolved selection
    if (dryRun && isLimited) {
      try {
        const result = await runSync(strapi, options)
        ctx.status = 200
        ctx.body = result
      } catch (error) {
        strapi.log.error(`[gateway-sync] Dry-run failed: ${formatError(error)}`)
        ctx.status = 500
        ctx.body = { error: formatError(error) }
      }
      return
    }

    // Fire and forget — sync runs in background
    runSync(strapi, options).catch((error) => {
      strapi.log.error(
        `[gateway-sync] Background sync failed: ${formatError(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: isLimited
        ? "Gateway limited seed import started"
        : "Gateway sync started",
      phases,
      isLimited: !!isLimited,
      status: getSyncStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSyncStatus()
  },
})
