import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"
import { ensureRevalidationWebhook } from "./bootstrap/revalidation-webhook"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    await ensureRevalidationWebhook(
      strapi,
      process.env.REVALIDATION_WEBHOOK_URL,
      process.env.REVALIDATION_SECRET,
    )
    // Easter seed disabled — videos now come from gateway sync.
    // TODO: rewrite seed to reference synced videos by gatewayId
    // instead of creating its own.
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
