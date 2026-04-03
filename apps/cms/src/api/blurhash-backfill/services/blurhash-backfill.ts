import type { Core } from "@strapi/strapi"
import { generateBlurhash } from "../../../utils/generate-blurhash"

type BackfillStatus = {
  running: boolean
  total: number
  processed: number
  errors: number
  startedAt: string | null
  completedAt: string | null
}

let status: BackfillStatus = {
  running: false,
  total: 0,
  processed: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
}

const BATCH_SIZE = 50
const CONCURRENCY = 5

export function getBackfillStatus(): BackfillStatus {
  return { ...status }
}

export async function runBackfill(strapi: Core.Strapi): Promise<void> {
  if (status.running) {
    throw new Error("Backfill is already running")
  }

  status = {
    running: true,
    total: 0,
    processed: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  }

  try {
    await backfillBlurhashes(strapi)
  } finally {
    status.running = false
    status.completedAt = new Date().toISOString()
  }
}

async function backfillBlurhashes(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection

  const rows: Array<{ id: number; url: string }> = await knex("video_images")
    .select("id", "url")
    .whereNull("blurhash")
    .whereNotNull("url")
    .where("url", "!=", "")

  status.total = rows.length
  strapi.log.info(`[blurhash-backfill] Found ${rows.length} images to process`)

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    await processBatch(strapi, knex, batch)
  }

  strapi.log.info(
    `[blurhash-backfill] Complete: ${status.processed} processed, ${status.errors} errors`,
  )
}

async function processBatch(
  strapi: Core.Strapi,
  knex: Core.Strapi["db"]["connection"],
  rows: Array<{ id: number; url: string }>,
): Promise<void> {
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const hash = await generateBlurhash(row.url)
          await knex("video_images")
            .where("id", row.id)
            .update({ blurhash: hash })
          status.processed++
        } catch (error) {
          status.errors++
          strapi.log.warn(
            `[blurhash-backfill] Failed for id=${row.id} url=${row.url}: ${error}`,
          )
        }
      }),
    )
  }
}
