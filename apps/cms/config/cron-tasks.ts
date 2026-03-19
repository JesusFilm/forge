import type { Core } from "@strapi/strapi"

const cronTasks = {
  "gateway-sync": {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      strapi.log.info("[gateway-sync] Cron triggered")
      try {
        const syncService = strapi.service(
          "api::gateway-sync.gateway-sync",
        ) as { runFullSync: () => Promise<unknown> }
        await syncService.runFullSync()
      } catch (error) {
        strapi.log.error(
          `[gateway-sync] Cron sync failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    },
    options: {
      rule: process.env.GATEWAY_SYNC_CRON ?? "0 3 * * *",
    },
  },
}

export default cronTasks
