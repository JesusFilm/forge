import { ensureInternalApiToken } from "./internal-api-token"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: unknown }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
