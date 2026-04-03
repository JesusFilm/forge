import type { Core } from "@strapi/strapi"
import { generateBlurhash } from "../../../utils/generate-blurhash"

const CONCURRENCY = 5

/**
 * Generate blurhash for video_image records that have a URL but no blurhash.
 * Runs after core sync to cover newly imported images.
 */
export async function generateBlurhashForNewImages(
  strapi: Core.Strapi,
): Promise<void> {
  const knex = strapi.db.connection

  const rows: Array<{ id: number; url: string }> = await knex("video_images")
    .select("id", "url")
    .whereNull("blurhash")
    .whereNotNull("url")
    .where("url", "!=", "")

  if (rows.length === 0) return

  strapi.log.info(
    `[core-sync] Generating blurhash for ${rows.length} images...`,
  )

  let processed = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const hash = await generateBlurhash(row.url)
          await knex("video_images")
            .where("id", row.id)
            .update({ blurhash: hash })
          processed++
        } catch (error) {
          errors++
          strapi.log.warn(
            `[core-sync] Blurhash failed for id=${row.id}: ${error}`,
          )
        }
      }),
    )
  }

  strapi.log.info(
    `[core-sync] Blurhash generation complete: ${processed} processed, ${errors} errors`,
  )
}
