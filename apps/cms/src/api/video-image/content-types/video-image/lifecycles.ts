import { generateBlurhash } from "../../../../utils/generate-blurhash"
import { formatError } from "../../../core-sync/services/strapi-helpers"

// This lifecycle hook only fires for Strapi Document Service writes (admin
// panel, GraphQL mutations). Core sync uses raw knex via bulkUpsertByCoreId,
// which bypasses lifecycle hooks entirely — that path is covered by the
// post-sync blurhash step in core-sync.ts.

export default {
  async beforeCreate(event: { params: { data: Record<string, unknown> } }) {
    const { data } = event.params
    if (!data.url || typeof data.url !== "string") return
    if (data.blurhash) return

    try {
      data.blurhash = await generateBlurhash(data.url)
    } catch (error) {
      strapi.log.warn(
        `[video-image] Failed to generate blurhash: ${formatError(error)}`,
      )
    }
  },

  async beforeUpdate(event: {
    params: { data: Record<string, unknown>; where: { id?: number } }
  }) {
    const { data } = event.params

    // No URL in this update — nothing to do
    if (!data.url || typeof data.url !== "string") return

    // If blurhash is explicitly set in this update, respect it
    if (data.blurhash) return

    // URL is changing — always regenerate blurhash for the new image
    try {
      data.blurhash = await generateBlurhash(data.url)
    } catch (error) {
      strapi.log.warn(
        `[video-image] Failed to generate blurhash: ${formatError(error)}`,
      )
    }
  },
}
