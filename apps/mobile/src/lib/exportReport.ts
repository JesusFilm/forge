/**
 * The report fold and the views it feeds. A run publishes one signal per
 * terminal outcome and this module folds them into ONE report, so twelve
 * episodes report once (R21) and never twelve times.
 *
 * R25 lives here too. A refusal the operating system will not prompt for again
 * reads differently from a first refusal and carries a settings action, because
 * "try again" is advice the viewer cannot act on once the prompt is gone.
 *
 * Nothing here touches React. `ExportReportHost.tsx` owns the channel, the
 * component and the styles, and re-exports the signal type for its producers.
 */

import {
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "./color"
import type { ExportAlbumIntent, ExportOutcome } from "./exportSession"
import { RAW_EXPORT_ALBUM_NAME } from "./rawExportConstants"

/** How long a report that needs no viewer action stays on screen. */
export const EXPORT_REPORT_AUTO_DISMISS_MS = 6000

/** How many reports the host stacks before it drops the oldest. */
export const MAX_VISIBLE_REPORTS = 3

/** One terminal outcome. A series run publishes one of these per episode. */
export type ExportReportSignal = {
  /** One single export, or one whole series run. Folds the run into a report. */
  runId: string
  /** The video slug this outcome belongs to. */
  target: string
  outcome: ExportOutcome
  /**
   * Episodes the run covers. Absent or 1 reads as a single export. The fold
   * COUNTS the signals, so a run of this size must publish one signal per
   * episode; one signal for a whole run would report "saved 1 of N".
   */
  runSize?: number
  /** The video's title, or the series' title for a run. */
  title?: string | null
  albumIntent?: ExportAlbumIntent
  /** Refusal only. `false` means the operating system will not prompt again. */
  canAskAgain?: boolean
  /** A reason the fold cannot derive, such as which gate blocked the export. */
  detail?: string | null
}

export type ExportReportRecord = {
  runId: string
  title: string | null
  runSize: number
  /**
   * Keyed by target, not counted, so a producer that publishes an episode
   * twice cannot report 13 saved of 12. R21 needs saved plus failed to equal
   * the resolved set.
   */
  outcomes: Readonly<Record<string, ExportOutcome>>
  albumIntent: ExportAlbumIntent | null
  permanentRefusal: boolean
  detail: string | null
  /** Null holds the report until the viewer acts on it. */
  expiresAt: number | null
}

export type ExportReportView = {
  title: string | null
  headline: string
  detail: string | null
  settings: boolean
  icon: "checkmark-circle" | "alert-circle" | "close-circle" | "lock-closed"
  iconColor: string
}

function countOutcomes(
  record: ExportReportRecord,
): Record<ExportOutcome, number> {
  const counts: Record<ExportOutcome, number> = {
    saved: 0,
    failed: 0,
    blocked: 0,
    refused: 0,
    cancelled: 0,
    abandoned: 0,
  }
  for (const outcome of Object.values(record.outcomes)) counts[outcome] += 1
  return counts
}

export function foldSignal(
  records: readonly ExportReportRecord[],
  signal: ExportReportSignal,
  now: number,
): ExportReportRecord[] {
  const existing = records.find((record) => record.runId === signal.runId)
  const permanentRefusal =
    (existing?.permanentRefusal ?? false) ||
    (signal.outcome === "refused" && signal.canAskAgain === false)

  const next: ExportReportRecord = {
    runId: signal.runId,
    title: existing?.title ?? signal.title ?? null,
    runSize: Math.max(existing?.runSize ?? 1, signal.runSize ?? 1),
    outcomes: { ...existing?.outcomes, [signal.target]: signal.outcome },
    albumIntent: signal.albumIntent ?? existing?.albumIntent ?? null,
    permanentRefusal,
    detail: signal.detail ?? existing?.detail ?? null,
    expiresAt: permanentRefusal ? null : now + EXPORT_REPORT_AUTO_DISMISS_MS,
  }

  const others = records.filter((record) => record.runId !== signal.runId)
  return [...others, next].slice(-MAX_VISIBLE_REPORTS)
}

// A single export reaches exactly one outcome, but a stray second signal must
// still read sensibly, so the worst outcome wins.
const SINGLE_PRIORITY: readonly ExportOutcome[] = [
  "refused",
  "blocked",
  "failed",
  "abandoned",
  "cancelled",
  "saved",
]

function singleOutcome(counts: Record<ExportOutcome, number>): ExportOutcome {
  return SINGLE_PRIORITY.find((outcome) => counts[outcome] > 0) ?? "saved"
}

function savedHeadline(albumIntent: ExportAlbumIntent | null): string {
  // R17: an add-only grant on iOS cannot make an album, so the confirmation
  // names whatever the export actually reached.
  return albumIntent === "album"
    ? `Saved to the ${RAW_EXPORT_ALBUM_NAME} album.`
    : "Saved to your photo library."
}

function singleView(
  record: ExportReportRecord,
  counts: Record<ExportOutcome, number>,
): ExportReportView {
  const outcome = singleOutcome(counts)
  const settings = record.permanentRefusal
  const detail = (fallback: string | null) => record.detail ?? fallback

  switch (outcome) {
    case "refused":
      return settings
        ? {
            title: record.title,
            headline: "Photo library access is off for this app.",
            detail: "Turn on photo access in Settings, then try again.",
            settings: true,
            icon: "lock-closed",
            iconColor: WARNING_COLOR,
          }
        : {
            title: record.title,
            headline: "Permission is needed to save to your photo library.",
            detail: "Start the export again to see the prompt.",
            settings: false,
            icon: "lock-closed",
            iconColor: WARNING_COLOR,
          }
    case "blocked":
      return {
        title: record.title,
        headline: "The export did not start.",
        detail: detail(null),
        settings: false,
        icon: "alert-circle",
        iconColor: WARNING_COLOR,
      }
    case "failed":
      return {
        title: record.title,
        headline: "The video did not save.",
        detail: detail(null),
        settings: false,
        icon: "alert-circle",
        iconColor: STATUS_FAILED_COLOR,
      }
    case "abandoned":
      return {
        title: record.title,
        headline: "The export did not finish.",
        detail: detail("Start it again to keep a copy."),
        settings: false,
        icon: "alert-circle",
        iconColor: STATUS_FAILED_COLOR,
      }
    case "cancelled":
      return {
        title: record.title,
        headline: "Export cancelled.",
        detail: detail(null),
        settings: false,
        icon: "close-circle",
        iconColor: TEXT_SECONDARY,
      }
    default:
      return {
        title: record.title,
        headline: savedHeadline(record.albumIntent),
        detail: detail(null),
        settings: false,
        icon: "checkmark-circle",
        iconColor: STATUS_DONE_COLOR,
      }
  }
}

function seriesView(
  record: ExportReportRecord,
  counts: Record<ExportOutcome, number>,
): ExportReportView {
  const notes: string[] = []
  if (counts.cancelled > 0) notes.push("Export cancelled.")
  if (counts.failed > 0) notes.push(`${counts.failed} did not save.`)
  if (counts.blocked > 0) notes.push(`${counts.blocked} did not start.`)
  if (counts.abandoned > 0) notes.push(`${counts.abandoned} did not finish.`)
  if (counts.refused > 0) {
    notes.push(
      record.permanentRefusal
        ? "Turn on photo access in Settings, then try again."
        : "Photo library permission was refused.",
    )
  }
  if (record.detail) notes.push(record.detail)

  const clean = counts.saved === record.runSize
  return {
    title: record.title,
    // R21: saved against the resolved set, always — a cancelled or refused run
    // still tells the viewer how many episodes reached the library.
    headline: `Saved ${counts.saved} of ${record.runSize} episodes.`,
    detail: notes.length > 0 ? notes.join(" ") : null,
    settings: record.permanentRefusal,
    icon: clean ? "checkmark-circle" : "alert-circle",
    iconColor: clean ? STATUS_DONE_COLOR : WARNING_COLOR,
  }
}

export function viewFor(record: ExportReportRecord): ExportReportView {
  const counts = countOutcomes(record)
  return record.runSize > 1
    ? seriesView(record, counts)
    : singleView(record, counts)
}
