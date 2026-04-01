import type { Core } from "@strapi/strapi"
import {
  runSync,
  resolveScope,
  getSyncStatus,
  getPersistedSyncStatus,
} from "../services/core-sync"
import { formatError } from "../services/strapi-helpers"

type StrapiContext = {
  request: { body?: { scope?: string | string[]; incremental?: boolean } }
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    if (process.env.NODE_ENV !== "production") {
      ctx.status = 403
      ctx.body = {
        error:
          "Core sync can only be triggered in production. Use pnpm data-import to restore a snapshot locally.",
      }
      return
    }

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
    const status = getSyncStatus()
    const isProduction = process.env.NODE_ENV === "production"

    // When idle with no in-memory lastRun (e.g. after restart), enrich with
    // persistent watermarks from the core_sync_states table so the UI always
    // shows when the last sync ran and which phases were included.
    if (!status.inProgress && !status.lastRun) {
      const persisted = await getPersistedSyncStatus(strapi)
      ctx.body = { ...status, ...persisted, isProduction }
      return
    }

    ctx.body = { ...status, isProduction }
  },
})
