import type { Core } from "@strapi/strapi"
import { processMissingBlurhashes } from "../../../utils/process-missing-blurhashes"

/**
 * Generate blurhash for video_image records that have a URL but no blurhash.
 * Runs after core sync to cover newly imported images.
 *
 * This exists separately from the lifecycle hook because core sync uses raw
 * knex (bulkUpsertByCoreId), which bypasses Strapi's Document Service and
 * therefore does not trigger lifecycle hooks.
 */
export async function generateBlurhashForNewImages(
  strapi: Core.Strapi,
): Promise<void> {
  await processMissingBlurhashes(strapi, { logPrefix: "[core-sync]" })
}
