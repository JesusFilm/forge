/**
 * R29: the route that starts a raw export does not outlive the export. The
 * viewer dismisses the sheet, walks back to Home, and the transfer keeps
 * running, so a report owned by a screen is a report nobody sees. This host
 * mounts beside the root stack (KTD5) and reports every terminal outcome from
 * there.
 *
 * The channel below is the whole contract for producers. One call per terminal
 * outcome, carrying the run it belongs to: a single export publishes once, and
 * a series run publishes once per episode under ONE `runId`. The host folds a
 * run's outcomes into a single report, so twelve episodes report once (R21) and
 * never twelve times.
 *
 * R25 lives here too. A refusal the operating system will not prompt for again
 * reads differently from a first refusal and carries a settings action, because
 * "try again" is advice the viewer cannot act on once the prompt is gone.
 */

import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../hooks/useTypography"
import {
  ACCENT_ON_DARK,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  WARNING_COLOR,
} from "../lib/color"
import type { ExportAlbumIntent, ExportOutcome } from "../lib/exportSession"
import { RAW_EXPORT_ALBUM_NAME } from "../lib/rawExportConstants"

/** How long a report that needs no viewer action stays on screen. */
export const EXPORT_REPORT_AUTO_DISMISS_MS = 6000

const MAX_VISIBLE_REPORTS = 3
const MAX_BUFFERED_SIGNALS = 20

const SETTINGS_LABEL = "Open settings"
const DISMISS_LABEL = "Dismiss export report"
const REPORT_LABEL = "Export report"

/** One terminal outcome. A series run publishes one of these per episode. */
export type ExportReportSignal = {
  /** One single export, or one whole series run. Folds the run into a report. */
  runId: string
  /** The video slug this outcome belongs to. */
  target: string
  outcome: ExportOutcome
  /**
   * Episodes the run covers. Absent or 1 reads as a single export. The host
   * COUNTS the signals, so a run of this size must publish one signal per
   * episode; one signal for a whole run would report "saved 1 of N".
   */
  runSize?: number
  /** The video's title, or the series' title for a run. */
  title?: string | null
  albumIntent?: ExportAlbumIntent
  /** Refusal only. `false` means the operating system will not prompt again. */
  canAskAgain?: boolean
  /** A reason the host cannot derive, such as which gate blocked the export. */
  detail?: string | null
}

type ExportReportListener = (signal: ExportReportSignal) => void

const listeners = new Set<ExportReportListener>()

// The launch sweep (U7) reports abandoned exports before this host has mounted,
// so a signal with no listener waits rather than vanishing.
const buffered: ExportReportSignal[] = []

/** Report one terminal outcome to the viewer. Never throws into the caller. */
export function publishExportReport(signal: ExportReportSignal): void {
  if (listeners.size === 0) {
    buffered.push(signal)
    if (buffered.length > MAX_BUFFERED_SIGNALS) buffered.shift()
    return
  }
  deliver(listeners, signal)
}

export function subscribeToExportReports(
  listener: ExportReportListener,
): () => void {
  listeners.add(listener)
  const pending = buffered.splice(0, buffered.length)
  for (const signal of pending) deliver([listener], signal)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: drop every listener and every buffered signal. */
export function resetExportReportsForTests(): void {
  listeners.clear()
  buffered.length = 0
}

/** A listener's throw must not replace the outcome the export actually reached. */
function deliver(
  targets: Iterable<ExportReportListener>,
  signal: ExportReportSignal,
): void {
  for (const listener of targets) {
    try {
      listener(signal)
    } catch {
      // Deliberately ignored; see the note above.
    }
  }
}

type ExportReportRecord = {
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

function foldSignal(
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

type ExportReportView = {
  title: string | null
  headline: string
  detail: string | null
  settings: boolean
  icon: "checkmark-circle" | "alert-circle" | "close-circle" | "lock-closed"
  iconColor: string
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

function viewFor(record: ExportReportRecord): ExportReportView {
  const counts = countOutcomes(record)
  return record.runSize > 1
    ? seriesView(record, counts)
    : singleView(record, counts)
}

export function ExportReportHost() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const [reports, setReports] = useState<readonly ExportReportRecord[]>([])

  useEffect(() => {
    return subscribeToExportReports((signal) => {
      setReports((current) => foldSignal(current, signal, Date.now()))
    })
  }, [])

  // The deadline is re-derived from state on every run, so a StrictMode
  // remount rebuilds the timer rather than stranding a report on screen.
  useEffect(() => {
    const deadlines = reports
      .map((record) => record.expiresAt)
      .filter((value): value is number => value !== null)
    if (deadlines.length === 0) return
    const timer = setTimeout(
      () => {
        const now = Date.now()
        setReports((current) => {
          const next = current.filter(
            (record) => record.expiresAt === null || record.expiresAt > now,
          )
          return next.length === current.length ? current : next
        })
      },
      Math.max(0, Math.min(...deadlines) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [reports])

  const dismiss = useCallback((runId: string) => {
    setReports((current) => current.filter((record) => record.runId !== runId))
  }, [])

  const openSettings = useCallback(
    (runId: string) => {
      dismiss(runId)
      Linking.openSettings().catch(() => undefined)
    },
    [dismiss],
  )

  if (reports.length === 0) return null

  return (
    // Anchored at the top: the mini player parks in a bottom corner, and the
    // tab bar floats over the bottom edge on the tab routes.
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 12 }]}
    >
      {reports.map((record) => {
        const view = viewFor(record)
        return (
          <View
            key={record.runId}
            accessibilityLabel={REPORT_LABEL}
            style={styles.card}
          >
            <Ionicons name={view.icon} size={20} color={view.iconColor} />
            <View style={styles.body}>
              {view.title ? (
                <Text
                  style={[styles.title, typography.caption]}
                  numberOfLines={1}
                >
                  {view.title}
                </Text>
              ) : null}
              <Text style={[styles.headline, typography.bodySmall]}>
                {view.headline}
              </Text>
              {view.detail ? (
                <Text style={[styles.detail, typography.caption]}>
                  {view.detail}
                </Text>
              ) : null}
              {view.settings ? (
                <Pressable
                  onPress={() => openSettings(record.runId)}
                  accessibilityRole="button"
                  accessibilityLabel={SETTINGS_LABEL}
                  hitSlop={8}
                  style={styles.action}
                >
                  <Text style={[styles.actionText, typography.bodySmall]}>
                    {SETTINGS_LABEL}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => dismiss(record.runId)}
              accessibilityRole="button"
              accessibilityLabel={DISMISS_LABEL}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={TEXT_SECONDARY} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    gap: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: SURFACE_COLOR,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  headline: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  detail: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  action: {
    paddingTop: 8,
  },
  actionText: {
    color: ACCENT_ON_DARK,
    fontFamily: "System",
    fontWeight: "600",
  },
})
