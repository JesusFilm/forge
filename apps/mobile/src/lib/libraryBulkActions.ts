import { effectiveDownloadBytes } from "./libraryDownloads"
import type { OfflineDownloadRecord } from "./offlineManifest"

/**
 * Pure Library bulk-action orchestrator (U5's tested heart): injected
 * deleteDownload/retryDownload deps, no React. Re-intersects the requested
 * slugs with the LIVE records at call time and derives every count from the
 * per-slug call outcome — never from aggregate download state (KTD4).
 */

export type BulkDeleteResult = {
  deletedCount: number
  freedBytes: number
  failedCount: number
}

/**
 * Deletes each live slug sequentially via deleteDownload. A slug already
 * gone from `records` is skipped (not counted); a per-slug rejection is
 * recorded and the loop continues rather than aborting the rest.
 */
export async function bulkDelete({
  slugs,
  records,
  deleteDownload,
}: {
  slugs: readonly string[]
  records: readonly OfflineDownloadRecord[]
  deleteDownload: (videoSlug: string) => Promise<void>
}): Promise<BulkDeleteResult> {
  const bySlug = new Map(records.map((record) => [record.videoSlug, record]))

  let deletedCount = 0
  let freedBytes = 0
  let failedCount = 0

  for (const slug of slugs) {
    const record = bySlug.get(slug)
    if (!record) continue // vanished before delete — outside the live set

    try {
      await deleteDownload(slug)
      deletedCount += 1
      freedBytes += effectiveDownloadBytes(record)
    } catch {
      failedCount += 1
    }
  }

  return { deletedCount, freedBytes, failedCount }
}

/**
 * Retries only the selected slugs whose live record is `failed`. Returns the
 * count actually retried (a per-slug rejection doesn't abort the rest).
 */
export async function retryFailedSelected({
  slugs,
  records,
  retryDownload,
}: {
  slugs: readonly string[]
  records: readonly OfflineDownloadRecord[]
  retryDownload: (videoSlug: string) => Promise<void>
}): Promise<number> {
  const bySlug = new Map(records.map((record) => [record.videoSlug, record]))

  let retriedCount = 0
  for (const slug of slugs) {
    if (bySlug.get(slug)?.state !== "failed") continue
    try {
      await retryDownload(slug)
      retriedCount += 1
    } catch {
      // continue — one failure never aborts the rest.
    }
  }

  return retriedCount
}
