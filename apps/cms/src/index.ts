import type { Core } from "@strapi/strapi"
import { ensureCoreIdIndexes } from "./bootstrap/ensure-core-id-indexes"
import { ensurePlannerStats } from "./bootstrap/ensure-planner-stats"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"
import { ensureRevalidationWebhook } from "./bootstrap/revalidation-webhook"
import { seedEaster } from "./bootstrap/seed-easter"
import { seedChristmas } from "./bootstrap/seed-christmas"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Schema-only init: exit after DB tables and migrations are created.
    // Used by data-import-check to prepare a fresh DB before restoring a snapshot.
    if (process.env["STRAPI_INIT_ONLY"] === "true") {
      strapi.log.info("[bootstrap] Schema initialized (STRAPI_INIT_ONLY)")
      process.exit(0)
    }

    await ensureCoreIdIndexes(strapi)
    await ensurePlannerStats(strapi)
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    await ensureRevalidationWebhook(
      strapi,
      process.env.REVALIDATION_WEBHOOK_URL,
      process.env.REVALIDATION_SECRET,
    )

    if (
      process.env.SEED_ON_BOOT === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      try {
        await seedEaster(strapi)
      } catch (err) {
        strapi.log.error(
          `[seed-easter] ${err instanceof Error ? err.message : err}`,
        )
      }

      try {
        await seedChristmas(strapi)
      } catch (err) {
        strapi.log.error(
          `[seed-christmas] ${err instanceof Error ? err.message : err}`,
        )
      }
    }
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
