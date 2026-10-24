import {
  isBatchPlaceholderRecord,
  type OfflineDownloadRecord,
} from "./offlineManifest"
import type { StartDownloadRequest } from "./downloadLifecycle"

// Sequential batch pump (R14): series batch downloads (incl. RE-downloads, which
// swap a still-saved episode) run ONE at a time in episode order — the next begins
// only at the previous one's terminal state. Pure core; the provider applies it.

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
  // A processable head is a fresh `queued` placeholder (→ start) or a completed
  // copy to replace (→ swap). Anything else (gone/canceled/claimed) is dropped.
  if (isBatchPlaceholderRecord(record) || record?.state === "downloaded") {
    return { kind: "start", request: head }
  }
  return { kind: "drop", videoSlug: head.videoSlug }
}

/**
 * Gate for accepting an episode into the batch queue. Reject a slug already
 * queued, or one an in-flight transfer owns (downloading/paused). A downloaded
 * copy IS queueable — the pump swaps it to the new choice at its turn.
 */
/**
 * Whether an empty-queue pump wake should release the occupancy scope. False
 * for an already-empty scope: the pump wakes on every records change, so an
 * unguarded release would emit a no-op `batch.pump` log row per wake.
 */
export function shouldReleaseBatchScope(
  records: Readonly<Record<string, OfflineDownloadRecord>>,
  batchSlugs: ReadonlySet<string>,
): boolean {
  if (batchSlugs.size === 0) return false
  return !Object.values(records).some(
    (record) =>
      batchSlugs.has(record.videoSlug) &&
      (record.state === "downloading" || record.state === "paused"),
  )
}

export function canQueueBatchDownload(
  records: Readonly<Record<string, OfflineDownloadRecord>>,
  queue: readonly StartDownloadRequest[],
  videoSlug: string,
): boolean {
  if (queue.some((request) => request.videoSlug === videoSlug)) return false
  const existing = records[videoSlug]
  return existing?.state !== "downloading" && existing?.state !== "paused"
}
