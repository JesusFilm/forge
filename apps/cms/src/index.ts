import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"
import { seedEaster } from "./bootstrap/seed-easter"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    if (process.env.DOPPLER_CONFIG === "prd") {
      await seedEaster(strapi)
      return
    }

    strapi.log.info(
      `[seed-easter] Skipped because DOPPLER_CONFIG is "${process.env.DOPPLER_CONFIG ?? "undefined"}", expected "prd".`,
    )
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
