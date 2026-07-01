import type { OfflineDownloadState } from "./offlineManifest"

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
