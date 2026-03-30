import type { Core } from "@strapi/strapi"
import { runSync, resolveScope, getSyncStatus } from "../services/core-sync"
import { formatError } from "../services/strapi-helpers"

type StrapiContext = {
  request: { body?: { scope?: string | string[]; incremental?: boolean } }
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    const scope = ctx.request.body?.scope
    const incremental =
      ctx.request.body?.incremental !== undefined
        ? ctx.request.body.incremental === true
        : undefined
    const phases = resolveScope(scope)

    // Fire and forget — sync runs in background
    runSync(strapi, { scope, incremental }).catch((error) => {
      strapi.log.error(
        `[core-sync] Background sync failed: ${formatError(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: `Core sync started (${incremental === false ? "full" : "incremental"})`,
      incremental: incremental ?? true,
      phases,
      status: getSyncStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSyncStatus()
  },
})
