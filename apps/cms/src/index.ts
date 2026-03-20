import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    // Easter seed disabled — videos now come from gateway sync.
    // TODO: rewrite seed to reference synced videos by gatewayId
    // instead of creating its own.
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
