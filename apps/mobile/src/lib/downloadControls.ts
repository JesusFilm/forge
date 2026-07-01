import type {
  OfflineDownloadRecord,
  OfflineDownloadState,
} from "./offlineManifest"

/**
 * The user-facing controls a download row / item exposes, derived purely from its
 * record state (U3). Kept React-free so it unit-tests directly and is the single
 * source consumed by the Library rows (U7) and the series batch bar (U8) — no
 * duplicated state machine. Cancel/delete confirm at the call site (R11); pause
 * and resume are non-destructive and confirm-free.
 */
export type DownloadControl = "pause" | "resume" | "cancel" | "delete"

/**
 * downloading → pause + cancel · paused → resume + cancel · queued → cancel ·
 * downloaded → delete · failed → delete · canceled → none. `queued` has no live
 * transfer to pause yet, so it offers cancel only.
 */
export function controlsForState(
  state: OfflineDownloadState,
): DownloadControl[] {
  switch (state) {
    case "downloading":
      return ["pause", "cancel"]
    case "paused":
      return ["resume", "cancel"]
    case "queued":
      return ["cancel"]
    case "downloaded":
      return ["delete"]
    case "failed":
      return ["delete"]
    case "canceled":
      return []
  }
}

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
