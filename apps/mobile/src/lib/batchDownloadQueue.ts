import {
  isBatchPlaceholderRecord,
  type OfflineDownloadRecord,
} from "./offlineManifest"
import type { StartDownloadRequest } from "../contexts/DownloadsProvider"

// Sequential batch pump (R14): series batch downloads start ONE at a time in
// episode order — the next begins when the previous reaches a terminal state —
// so episode 1 finishes first, then 2, instead of size-ordered completion.
// Pure decision core; the provider owns the queue ref and applies actions.

export const BATCH_DOWNLOAD_CONCURRENCY = 1

export type BatchPumpAction =
  | { kind: "empty" }
  | { kind: "wait" }
  | { kind: "drop"; videoSlug: string }
  | { kind: "start"; request: StartDownloadRequest }

/**
 * Decide the pump's next move. `batchSlugs` scopes occupancy to slugs this
 * session's batches enqueued: a PAUSED batch episode holds its slot (Pause all
 * must not advance the queue), while an unrelated long-paused download never
 * blocks a batch. A head whose placeholder is gone (canceled) or was claimed
 * by another flow (already live) is dropped, not started.
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
