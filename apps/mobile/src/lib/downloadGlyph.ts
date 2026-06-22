import { ACCENT_ON_DARK, TEXT_SECONDARY } from "./color"
import type { OfflineDownloadState } from "./offlineManifest"

/** Green tick for a completed offline copy. */
export const DOWNLOAD_DONE_COLOR = "#34d399"
/** Rose for a failed transfer (retry). */
export const DOWNLOAD_FAILED_COLOR = "#fb7185"

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["downloading", "queued", "paused"])

/** The exact Ionicons glyphs this state machine can emit (pins the contract). */
export type DownloadGlyphIcon =
  | "download-outline"
  | "checkmark-circle-outline"
  | "alert-circle-outline"
  | "arrow-down"
  | "pause"

export type DownloadGlyphInfo = {
  /** True while a transfer is live — the caller wraps `icon` in a progress ring. */
  inProgress: boolean
  /** Ionicons glyph: the in-ring glyph when inProgress, else the static icon. */
  icon: DownloadGlyphIcon
  color: string
  /** Spoken state — the button is icon-only, so this carries the meaning. */
  a11yLabel: string
}

/**
 * Map the offline lifecycle to the Download button's icon-only presentation:
 * a determinate ring while transferring, a green tick once saved, a retry glyph
 * on failure, else the idle download glyph. `canceled` falls through to idle by
 * design (matches the watch screen's `state !== "canceled"` re-download branch).
 */
export function downloadGlyphInfo(
  state: OfflineDownloadState | null | undefined,
  progress: number | null | undefined,
): DownloadGlyphInfo {
  if (state != null && IN_PROGRESS_STATES.has(state)) {
    const pct =
      progress != null && progress > 0
        ? Math.min(100, Math.round(progress * 100))
        : null
    return {
      inProgress: true,
      icon: state === "paused" ? "pause" : "arrow-down",
      color: ACCENT_ON_DARK,
      a11yLabel:
        state === "queued"
          ? "Download queued"
          : state === "paused"
            ? "Download paused"
            : pct != null
              ? `Downloading, ${pct}%`
              : "Downloading",
    }
  }
  switch (state) {
    case "downloaded":
      return {
        inProgress: false,
        icon: "checkmark-circle-outline",
        color: DOWNLOAD_DONE_COLOR,
        a11yLabel: "Downloaded",
      }
    case "failed":
      return {
        inProgress: false,
        icon: "alert-circle-outline",
        color: DOWNLOAD_FAILED_COLOR,
        a11yLabel: "Download failed, retry",
      }
    default:
      return {
        inProgress: false,
        icon: "download-outline",
        color: TEXT_SECONDARY,
        a11yLabel: "Download",
      }
  }
}
