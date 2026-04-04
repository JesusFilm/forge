import type { Core } from "@strapi/strapi"
import { generateBlurhash } from "./generate-blurhash"
import { formatError } from "../api/core-sync/services/strapi-helpers"

const DEFAULT_CONCURRENCY = 5

type ProcessOptions = {
  concurrency?: number
  logPrefix?: string
  /** Called after each successful generation */
  onProcessed?: () => void
  /** Called after each failed generation */
  onError?: () => void
  /** Checked before each chunk — return true to abort */
  isCancelled?: () => boolean
}

type ProcessResult = {
  processed: number
  errors: number
}

/**
 * Query video_images missing blurhash and generate them.
 * Deduplicates by core_id so draft+published rows don't cause double fetches.
 */
export async function processMissingBlurhashes(
  strapi: Core.Strapi,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    logPrefix = "[blurhash]",
    onProcessed,
    onError,
    isCancelled,
  } = options
  const knex = strapi.db.connection

  // Query distinct images by core_id to avoid fetching the same image twice
  // for draft and published rows. Pick the draft row's id as representative.
  const rows: Array<{ core_id: string; url: string }> = await knex(
    "video_images",
  )
    .select("core_id", "url")
    .whereNull("blurhash")
    .whereNotNull("url")
    .whereNotNull("core_id")
    .where("url", "!=", "")
    .whereNull("published_at")
    .groupBy("core_id", "url")

  if (rows.length === 0) return { processed: 0, errors: 0 }

  strapi.log.info(
    `${logPrefix} Generating blurhash for ${rows.length} images...`,
  )

  let processed = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += concurrency) {
    if (isCancelled?.()) {
      strapi.log.info(`${logPrefix} Cancelled after ${processed} processed`)
      break
    }

    const chunk = rows.slice(i, i + concurrency)
    const results = await Promise.all(
      chunk.map(async (row) => {
        try {
          const hash = await generateBlurhash(row.url)
          // Update both draft and published rows in one statement
          await knex("video_images")
            .where("core_id", row.core_id)
            .update({ blurhash: hash })
          return true
        } catch (error) {
          strapi.log.warn(
            `${logPrefix} Failed for core_id=${row.core_id}: ${formatError(error)}`,
          )
          return false
        }
      }),
    )

    for (const success of results) {
      if (success) {
        processed++
        onProcessed?.()
      } else {
        errors++
        onError?.()
      }
    }
  }

  strapi.log.info(
    `${logPrefix} Complete: ${processed} processed, ${errors} errors`,
  )

  return { processed, errors }
}
