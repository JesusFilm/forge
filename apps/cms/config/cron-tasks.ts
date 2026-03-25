import type { Core } from "@strapi/strapi"
import { formatError } from "../src/api/core-sync/services/strapi-helpers"

const cronTasks = {
  "core-sync": {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      strapi.log.info("[core-sync] Cron triggered (incremental)")
      try {
        const syncService = strapi.service("api::core-sync.core-sync") as {
          runSync: (options?: {
            scope?: string | string[]
            incremental?: boolean
          }) => Promise<unknown>
        }
        await syncService.runSync({ incremental: true })

        // Chain snapshot export after successful sync
        if (process.env.RAILWAY_S3_BUCKET) {
          strapi.log.info("[data-snapshot] Triggering post-sync snapshot")
          const snapshotService = strapi.service(
            "api::data-snapshot.data-snapshot",
          ) as { createSnapshot: () => Promise<unknown> }
          await snapshotService.createSnapshot()
        }
      } catch (error) {
        strapi.log.error(`[core-sync] Cron sync failed: ${formatError(error)}`)
      }
    },
    options: {
      rule: process.env.CORE_SYNC_CRON ?? "0 3 * * *",
    },
  },
}

export default cronTasks
