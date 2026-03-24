import type { Core } from "@strapi/strapi"

const cronTasks = {
  "core-sync": {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      strapi.log.info("[core-sync] Cron triggered")
      try {
        const syncService = strapi.service("api::core-sync.core-sync") as {
          runFullSync: () => Promise<unknown>
        }
        await syncService.runFullSync()

        // Chain snapshot export after successful sync
        if (process.env.RAILWAY_S3_BUCKET) {
          strapi.log.info("[data-snapshot] Triggering post-sync snapshot")
          const snapshotService = strapi.service(
            "api::data-snapshot.data-snapshot",
          ) as { createSnapshot: () => Promise<unknown> }
          await snapshotService.createSnapshot()
        }
      } catch (error) {
        strapi.log.error(
          `[core-sync] Cron sync failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    options: {
      rule: process.env.CORE_SYNC_CRON ?? "0 3 * * *",
    },
  },
}

export default cronTasks
