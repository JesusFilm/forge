import type { Core } from "@strapi/strapi"
import { ensureCoreIdIndexes } from "./bootstrap/ensure-core-id-indexes"
import { ensureInternalApiToken } from "./bootstrap/internal-api-token"
import { ensureRevalidationWebhook } from "./bootstrap/revalidation-webhook"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureCoreIdIndexes(strapi)
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    await ensureRevalidationWebhook(
      strapi,
      process.env.REVALIDATION_WEBHOOK_URL,
      process.env.REVALIDATION_SECRET,
    )
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
