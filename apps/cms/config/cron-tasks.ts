import type { Core } from "@strapi/strapi"
import { formatError } from "../src/api/core-sync/services/strapi-helpers"

const cronTasks = {
  "coverage-snapshot": {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      strapi.log.info("[coverage-snapshot] Starting daily coverage snapshot")
      try {
        const service = strapi.service(
          "api::coverage-snapshot.coverage-snapshot",
        ) as { createSnapshot: (ctx: { strapi: Core.Strapi }) => Promise<unknown> }
        await service.createSnapshot({ strapi })
        strapi.log.info("[coverage-snapshot] Snapshot complete")
      } catch (error) {
        strapi.log.error(
          `[coverage-snapshot] Failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    options: {
      // Must run BEFORE core-sync (03:00 UTC) to capture pre-sync state.
      // If core-sync schedule changes, update this too.
      rule: process.env.COVERAGE_SNAPSHOT_CRON ?? "0 2 * * *",
    },
  },
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
