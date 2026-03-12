import type { Core } from "@strapi/strapi"
import { ensureInternalApiToken } from "./internal-api-token"
import { seedQuizButton } from "./seed/quiz-button"

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureInternalApiToken(strapi, process.env.STRAPI_INTERNAL_API_TOKEN)
    await seedQuizButton(strapi)
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
