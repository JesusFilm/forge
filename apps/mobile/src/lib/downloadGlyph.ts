import {
  ACCENT_ON_DARK,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "./color"
import type { ExportSessionEntry } from "./exportSession"
import type { OfflineDownloadState } from "./offlineManifest"

/** Green tick for a completed offline copy. */
export const DOWNLOAD_DONE_COLOR = STATUS_DONE_COLOR
/** Rose for a failed transfer (retry). */
export const DOWNLOAD_FAILED_COLOR = STATUS_FAILED_COLOR
/**
 * One colour for a raw export on every indicator. It is NOT the download accent
 * on purpose: R16 wants a state the viewer tells apart from the offline ones.
 */
export const EXPORT_IN_PROGRESS_COLOR = TEXT_PRIMARY

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["downloading", "queued", "paused"])

/** The exact Ionicons glyphs this state machine can emit (pins the contract). */
export type DownloadGlyphIcon =
  | "download-outline"
  | "checkmark-circle-outline"
  | "alert-circle-outline"
  | "arrow-down"
  | "pause"
  | "arrow-up"

/**
 * The glyph inside the progress ring. The ring IS the control, so this glyph
 * names the tap — which is why `play` (resume) lives here and never in the
 * settled-state union above.
 */
export type DownloadRingIcon = DownloadGlyphIcon | "play"

export type DownloadGlyphInfo = {
  /** True while a transfer is live — the caller wraps `ringIcon` in a ring. */
  inProgress: boolean
  /** Ionicons glyph for a settled state; the ring replaces it when inProgress. */
  icon: DownloadGlyphIcon
  color: string
  /** Spoken label of the RENDERED control — it is icon-only, so this carries
   *  both the state and what a tap does. */
  a11yLabel: string
  /** Glyph drawn inside the ring while `inProgress`. */
  ringIcon: DownloadRingIcon
  /** 0..1 the ring draws — the export's own progress while one runs. */
  ringProgress: number
  /** False while an export runs: a tap must neither pause it nor open the
   *  sheet (R16, R24). */
  interactive: boolean
}

function clampFraction(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Whole percent, or null below 1% — a "0%" label reads as a stalled transfer. */
function percentOf(value: number | null | undefined): number | null {
  const fraction = clampFraction(value)
  return fraction > 0 ? Math.min(100, Math.round(fraction * 100)) : null
}

/** A settled state draws no ring, so its ring fields stay inert. */
function settled(
  icon: DownloadGlyphIcon,
  color: string,
  a11yLabel: string,
): DownloadGlyphInfo {
  return {
    inProgress: false,
    icon,
    color,
    a11yLabel,
    ringIcon: icon,
    ringProgress: 0,
    interactive: true,
  }
}

/**
 * The Download button's icon-only presentation, for the offline lifecycle and
 * for a raw export: a ring while transferring, green tick when saved, retry
 * glyph on failure, else idle. `canceled` falls through to idle by design.
 *
 * The ring glyph, the spoken label and the tap affordance are decided HERE, not
 * at the call site. Every rendered control took its own view of them before, so
 * a widened resolver alone would leave the ring offering the pause R24 forbids.
 */
export function downloadGlyphInfo(
  state: OfflineDownloadState | null | undefined,
  progress: number | null | undefined,
  exporting?: ExportSessionEntry | null,
): DownloadGlyphInfo {
  // R16: an export outranks every offline state, a finished copy included.
  if (exporting) {
    const pct = percentOf(exporting.progress)
    return {
      inProgress: true,
      icon: "arrow-up",
      color: EXPORT_IN_PROGRESS_COLOR,
      a11yLabel: pct != null ? `Saving to Photos, ${pct}%` : "Saving to Photos",
      ringIcon: "arrow-up",
      ringProgress: clampFraction(exporting.progress),
      interactive: false,
    }
  }
  if (state != null && IN_PROGRESS_STATES.has(state)) {
    const pct = percentOf(progress)
    return {
      inProgress: true,
      icon: state === "paused" ? "pause" : "arrow-down",
      color: ACCENT_ON_DARK,
      a11yLabel:
        state === "queued"
          ? "Download queued. Tap to remove"
          : state === "paused"
            ? "Download paused. Tap to resume or remove"
            : pct != null
              ? `Downloading, ${pct}%. Tap to pause`
              : "Downloading. Tap to pause",
      ringIcon:
        state === "paused"
          ? "play"
          : state === "queued"
            ? "arrow-down"
            : "pause",
      ringProgress: clampFraction(progress),
      interactive: true,
    }
  }
  switch (state) {
    case "downloaded":
      return settled(
        "checkmark-circle-outline",
        DOWNLOAD_DONE_COLOR,
        "Downloaded",
      )
    case "failed":
      return settled(
        "alert-circle-outline",
        DOWNLOAD_FAILED_COLOR,
        "Download failed, retry",
      )
    default:
      return settled("download-outline", TEXT_SECONDARY, "Download")
  }
}
