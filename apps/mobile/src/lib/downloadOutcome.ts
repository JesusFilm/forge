import type { OfflineDownloadState } from "./offlineManifest"

/**
 * Pure decision logic for the offline download engine (no native module): how an
 * interruption maps to a state + byte retention, and whether a bundle (media +
 * subtitle + poster) is complete enough for Downloaded. Kept pure so the
 * engine's brain is unit-testable without a device.
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
 * Classify an interruption per KTD7: self-healing → pause + keep bytes;
 * terminal → fail + keep bytes for explicit retry; user cancel → remove bytes.
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
 * Media must verify. A requested subtitle: verified → included, terminally
 * failed → auto-degrade to no-subtitle (don't strand the item), still pending →
 * incomplete. Poster is a non-blocking sidecar and never gates completion.
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
