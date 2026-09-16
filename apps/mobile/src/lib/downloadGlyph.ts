import {
  ACCENT_ON_DARK,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "./color"
import { clampFraction, type ExportSessionEntry } from "./exportSession"
import type { OfflineDownloadState } from "./offlineManifest"

/** Green tick for a completed offline copy. */
export const DOWNLOAD_DONE_COLOR = STATUS_DONE_COLOR
/** Rose for a failed transfer (retry). */
export const DOWNLOAD_FAILED_COLOR = STATUS_FAILED_COLOR
/**
 * The RING an export draws: the same red the offline ring uses, by owner
 * decision (2026-09-10), because an export is a download and reads as one.
 */
export const EXPORT_IN_PROGRESS_COLOR = ACCENT_ON_DARK

/**
 * The export's badge on an episode THUMBNAIL while it transfers: white, by
 * owner decision (2026-09-14), matching the offline download badge beside it.
 * The ring and everything inside it keep the red above — this is the corner
 * badge only, which is why it is not the ring colour.
 */
export const EXPORT_BADGE_COLOR = TEXT_PRIMARY

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
  // It now mirrors the offline affordance exactly — same arrow, same red ring,
  // pause while running, resume once paused (owner decision, 2026-09-10;
  // supersedes R24's cancel-only control).
  if (exporting) {
    const pct = percentOf(exporting.progress)
    if (exporting.paused) {
      return {
        inProgress: true,
        icon: "pause",
        color: EXPORT_IN_PROGRESS_COLOR,
        a11yLabel:
          pct != null
            ? `Saving to Files, paused at ${pct}%. Tap to resume or stop`
            : "Saving to Files, paused. Tap to resume or stop",
        ringIcon: "play",
        ringProgress: clampFraction(exporting.progress),
        interactive: true,
      }
    }
    return {
      inProgress: true,
      icon: "arrow-down",
      color: EXPORT_IN_PROGRESS_COLOR,
      a11yLabel:
        pct != null
          ? `Saving to Files, ${pct}%. Tap to pause`
          : "Saving to Files. Tap to pause",
      ringIcon: "pause",
      ringProgress: clampFraction(exporting.progress),
      interactive: true,
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
