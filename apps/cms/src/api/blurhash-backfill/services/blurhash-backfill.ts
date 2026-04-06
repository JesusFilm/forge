import type { Core } from "@strapi/strapi"
import { processMissingBlurhashes } from "../../../utils/process-missing-blurhashes"
import { formatError } from "../../../api/core-sync/services/strapi-helpers"

type BackfillStatus = {
  running: boolean
  cancelled: boolean
  total: number
  processed: number
  errors: number
  startedAt: string | null
  completedAt: string | null
}

let status: BackfillStatus = {
  running: false,
  cancelled: false,
  total: 0,
  processed: 0,
  errors: 0,
  startedAt: null,
  completedAt: null,
}

export function getBackfillStatus(): BackfillStatus {
  return { ...status }
}

export function cancelBackfill(): boolean {
  if (!status.running) return false
  status.cancelled = true
  return true
}

export async function runBackfill(strapi: Core.Strapi): Promise<void> {
  if (status.running) {
    throw new Error("Backfill is already running")
  }

  status = {
    running: true,
    cancelled: false,
    total: 0,
    processed: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  }

  try {
    // Count total for status reporting
    const knex = strapi.db.connection
    const [{ count }] = await knex("video_images")
      .count("* as count")
      .whereNull("blurhash")
      .whereNotNull("url")
      .whereNotNull("core_id")
      .where("url", "!=", "")
      .whereNull("published_at")
      .groupBy("core_id")
      .then((rows: Array<{ count: string }>) => [
        { count: rows.length.toString() },
      ])

    status.total = Number(count)

    const result = await processMissingBlurhashes(strapi, {
      logPrefix: "[blurhash-backfill]",
      onProcessed: () => {
        status.processed++
      },
      onError: () => {
        status.errors++
      },
      isCancelled: () => status.cancelled,
    })

    if (status.cancelled) {
      strapi.log.info(
        `[blurhash-backfill] Cancelled: ${result.processed} processed, ${result.errors} errors`,
      )
    }
  } catch (error) {
    strapi.log.error(`[blurhash-backfill] Failed: ${formatError(error)}`)
  } finally {
    status.running = false
    status.completedAt = new Date().toISOString()
  }
}
