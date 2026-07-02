import {
  isBatchPlaceholderRecord,
  isLiveDownloadRecord,
  type OfflineDownloadRecord,
} from "./offlineManifest"
import type { StartDownloadRequest } from "../contexts/DownloadsProvider"

// Sequential batch pump (R14): series batch downloads start ONE at a time in
// episode order — the next begins only at the previous one's terminal state.
// Pure decision core; the provider owns the queue ref and applies actions.

export const BATCH_DOWNLOAD_CONCURRENCY = 1

export type BatchPumpAction =
  | { kind: "empty" }
  | { kind: "wait" }
  | { kind: "drop"; videoSlug: string }
  | { kind: "start"; request: StartDownloadRequest }

/**
 * Decide the pump's next move. `batchSlugs` scopes occupancy: a PAUSED batch
 * episode holds its slot (Pause all must not advance the queue) while an
 * unrelated paused download never blocks; stale/claimed heads are dropped.
 */
export function nextBatchAction(
  records: Readonly<Record<string, OfflineDownloadRecord>>,
  queue: readonly StartDownloadRequest[],
  batchSlugs: ReadonlySet<string>,
  cap: number = BATCH_DOWNLOAD_CONCURRENCY,
): BatchPumpAction {
  if (queue.length === 0) return { kind: "empty" }

  let occupancy = 0
  for (const record of Object.values(records)) {
    if (!batchSlugs.has(record.videoSlug)) continue
    if (record.state === "downloading" || record.state === "paused") {
      occupancy += 1
    }
  }
  if (occupancy >= cap) return { kind: "wait" }

  const head = queue[0]
  const record = records[head.videoSlug]
  if (!isBatchPlaceholderRecord(record)) {
    return { kind: "drop", videoSlug: head.videoSlug }
  }
  return { kind: "start", request: head }
}

/**
 * Gate for accepting an episode into the batch queue: a live record another
 * flow owns (non-placeholder) or an already-queued slug rejects as `exists`.
 */
export function canQueueBatchDownload(
  records: Readonly<Record<string, OfflineDownloadRecord>>,
  queue: readonly StartDownloadRequest[],
  videoSlug: string,
): boolean {
  const existing = records[videoSlug]
  if (isLiveDownloadRecord(existing) && !isBatchPlaceholderRecord(existing)) {
    return false
  }
  return !queue.some((request) => request.videoSlug === videoSlug)
}
