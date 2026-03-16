import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"
import { seedEaster } from "./bootstrap/seed-easter"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    if (process.env.NODE_ENV !== "production") {
      await seedEaster(strapi)
    }
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
