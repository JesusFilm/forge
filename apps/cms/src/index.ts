import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./internal-api-token"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
