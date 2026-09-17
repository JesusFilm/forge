/**
 * R29: the route that starts a raw export does not outlive the export. The
 * viewer dismisses the sheet, walks back to Home, and the transfer keeps
 * running, so a report owned by a screen is a report nobody sees. This host
 * mounts beside the root stack (KTD5) and reports every terminal outcome from
 * there.
 *
 * The channel below is the whole contract for producers. One call per terminal
 * outcome, carrying the run it belongs to: a single export publishes once, and
 * a series run publishes once per episode under ONE `runId`. The fold that
 * turns those outcomes into one report, and the views it feeds, are pure and
 * live in `../lib/exportReport`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useSegments } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../hooks/useTypography"
import {
  isTabGroupRoute,
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_SCREEN_EXTENT_IOS,
  useTabBarClearance,
} from "../lib/tabBar"
import { SURFACE_COLOR, TEXT_PRIMARY, TEXT_SECONDARY } from "../lib/color"
import {
  getSeriesExportProgressSnapshot,
  subscribeToSeriesExportProgress,
} from "../lib/seriesExportProgress"
import {
  foldSignal,
  viewFor,
  type ExportReportRecord,
  type ExportReportSignal,
} from "../lib/exportReport"

// Every producer already imports the channel from this file, so the signal it
// must build stays importable from here too.
export { EXPORT_REPORT_AUTO_DISMISS_MS } from "../lib/exportReport"
export type { ExportReportSignal } from "../lib/exportReport"

const MAX_BUFFERED_SIGNALS = 20

const DISMISS_LABEL = "Dismiss export report"
const REPORT_LABEL = "Export report"

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

export function ExportReportHost() {
  const insets = useSafeAreaInsets()
  // The host outlives every route, so it derives the tab bar rather than
  // being told about it — Snackbar takes a `clearsTabBar` prop because each
  // of its callers knows its own route, and this one has no caller.
  const tabBarClearance = useTabBarClearance()
  // This host mounts at the ROOT, outside the tab controller, so its inset does
  // NOT carry the bar. The bar is a floating pill anchored to the SCREEN bottom
  // — 83pt on a 0-inset SE and on a 34pt iPhone 17 alike — so the inset does not
  // enter this at all. `> 0` keeps Android on its plain inset.
  const liftsOverBar = isTabGroupRoute(useSegments()) && tabBarClearance > 0
  const clearance = liftsOverBar
    ? TAB_BAR_SCREEN_EXTENT_IOS + TAB_BAR_CLEARANCE_GAP
    : 0
  const typography = useTypography()
  const [reports, setReports] = useState<readonly ExportReportRecord[]>([])

  useEffect(() => {
    return subscribeToExportReports((signal) => {
      setReports((current) => foldSignal(current, signal, Date.now()))
    })
  }, [])

  // A run's card is a PROGRESS card and must outlive the gap between two
  // episodes, which a transfer can stretch to minutes. No fixed window works:
  // one long enough for a slow link strands a dead run's card for as long. The
  // run itself says when it is over, so the card lives exactly that long.
  const liveRuns = useSyncExternalStore(
    subscribeToSeriesExportProgress,
    getSeriesExportProgressSnapshot,
  )
  const liveRunIds = useMemo(
    () => new Set(Object.values(liveRuns).map((run) => run.runId)),
    [liveRuns],
  )
  const keepsRunning = useCallback(
    (record: ExportReportRecord) => liveRunIds.has(record.runId),
    [liveRunIds],
  )

  // The deadline is re-derived from state on every run, so a StrictMode
  // remount rebuilds the timer rather than stranding a report on screen.
  useEffect(() => {
    const deadlines = reports
      .filter((record) => !keepsRunning(record))
      .map((record) => record.expiresAt)
    if (deadlines.length === 0) return
    const timer = setTimeout(
      () => {
        const now = Date.now()
        setReports((current) => {
          const next = current.filter(
            (record) => record.expiresAt > now || keepsRunning(record),
          )
          return next.length === current.length ? current : next
        })
      },
      Math.max(0, Math.min(...deadlines) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [reports, keepsRunning])

  const dismiss = useCallback((runId: string) => {
    setReports((current) => current.filter((record) => record.runId !== runId))
  }, [])

  if (reports.length === 0) return null

  return (
    // Bottom, on the same geometry as `ui/Snackbar`: 16 in from each side, and
    // 16 above EITHER the safe area or the bar — never both, or the inset is
    // counted twice. Cards stack upward, so the newest sits nearest the edge.
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        { bottom: (liftsOverBar ? clearance : insets.bottom) + 16 },
      ]}
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
})
