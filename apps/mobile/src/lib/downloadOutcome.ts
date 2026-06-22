import type { OfflineDownloadState } from "./offlineManifest"

/**
 * Pure decision logic for the offline download engine (no native module):
 *  - how a transfer interruption maps to a state and whether bytes are kept;
 *  - whether a download's bundle (media + chosen subtitle + poster) is complete
 *    enough to flip to Downloaded.
 *
 * The native engine adapter feeds these; keeping them pure makes the engine's
 * brain unit-testable without a device.
 */

/** Why a transfer stopped, as the adapter observes it. */
export type TransferInterruption =
  | { kind: "connectivity" }
  | { kind: "wifiOnlyOnCellular" }
  | { kind: "backgroundedTransient" }
  | { kind: "httpError"; status: number }
  | { kind: "integrity" }
  | { kind: "storageFull" }
  | { kind: "userCancel" }

export type OutcomeClassification = {
  state: Extract<OfflineDownloadState, "paused" | "failed" | "canceled">
  /** Keep partial bytes (resume/retry) vs remove them. */
  keepBytes: boolean
}

/**
 * Classify an interruption per KTD7: self-healing causes pause and keep bytes;
 * terminal causes fail and keep bytes for an explicit retry; a user cancel
 * removes bytes.
 */
export function classifyInterruption(
  interruption: TransferInterruption,
): OutcomeClassification {
  switch (interruption.kind) {
    case "connectivity":
    case "wifiOnlyOnCellular":
    case "backgroundedTransient":
      return { state: "paused", keepBytes: true }
    case "httpError":
    case "integrity":
    case "storageFull":
      return { state: "failed", keepBytes: true }
    case "userCancel":
      return { state: "canceled", keepBytes: false }
  }
}

/** Verification status of each part of a download's bundle. */
export type BundleParts = {
  mediaVerified: boolean
  /** Whether the user chose a subtitle track at all. */
  subtitleRequested: boolean
  subtitleVerified: boolean
  /** The chosen subtitle's transfer failed terminally (not still pending). */
  subtitleTerminallyFailed: boolean
}

export type BundleResolution =
  /** Flip to Downloaded (green tick). `subtitleDegraded` = chosen subtitle dropped. */
  | { kind: "downloaded"; subtitleDegraded: boolean }
  /** Not done yet — keep transferring. */
  | { kind: "incomplete" }

/**
 * Decide whether the bundle is complete enough to mark Downloaded (KTD4/KTD7).
 * Media must be verified. A requested subtitle that verified is included; one
 * that terminally failed auto-degrades to no-subtitle (the video still becomes
 * available) rather than stranding the item; one still pending keeps it
 * incomplete. The poster is a non-blocking sidecar and never gates completion.
 */
export function resolveBundle(parts: BundleParts): BundleResolution {
  if (!parts.mediaVerified) return { kind: "incomplete" }
  if (!parts.subtitleRequested)
    return { kind: "downloaded", subtitleDegraded: false }
  if (parts.subtitleVerified)
    return { kind: "downloaded", subtitleDegraded: false }
  if (parts.subtitleTerminallyFailed) {
    return { kind: "downloaded", subtitleDegraded: true }
  }
  return { kind: "incomplete" }
}
