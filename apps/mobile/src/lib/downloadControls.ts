import type { OfflineDownloadRecord } from "./offlineManifest"

export type CancelAction = "ignore" | "revert" | "remove"

/**
 * What canceling a download should do (from the code review). `ignore` a
 * completed/absent record — a cancel-all that raced an episode to completion must
 * NOT delete the finished copy. `revert` an in-flight SWAP to its old copy —
 * never destroy the previously-downloaded file that shares the video dir.
 * Otherwise `remove` a fresh in-flight download entirely.
 */
export function decideCancelAction(
  record: OfflineDownloadRecord | undefined,
): CancelAction {
  if (
    record?.state !== "queued" &&
    record?.state !== "downloading" &&
    record?.state !== "paused"
  ) {
    return "ignore"
  }
  return record.swapFrom ? "revert" : "remove"
}
