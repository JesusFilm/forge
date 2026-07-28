import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { TAB_BAR_STYLE } from "./_layout"

import { DeleteConfirmSheet } from "../../src/components/library/DeleteConfirmSheet"
import { DownloadRow } from "../../src/components/library/DownloadRow"
import { LibraryEmptyState } from "../../src/components/library/LibraryEmptyState"
import { SelectionActionBar } from "../../src/components/library/SelectionActionBar"
import { SeriesGroupCard } from "../../src/components/library/SeriesGroupCard"
import { StorageSummary } from "../../src/components/library/StorageSummary"
import { Snackbar } from "../../src/components/ui/Snackbar"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import { useTypography } from "../../src/hooks/useTypography"
import {
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../src/lib/color"
import { datadogLog } from "../../src/lib/datadog"
import {
  bulkDelete,
  retryFailedSelected,
} from "../../src/lib/libraryBulkActions"
import {
  buildLibraryViewModel,
  formatLibraryBytes,
  storageSummary,
} from "../../src/lib/libraryDownloads"
import {
  INITIAL_SELECTION_STATE,
  deselectAll,
  enterSelection,
  exitSelection,
  pruneToExisting,
  selectAll,
  selectionSummary,
  toggleSeriesHeader,
  toggleSeriesSlugs,
  toggleSlug,
  type LibrarySelectionState,
} from "../../src/lib/librarySelection"
import { totalDiskBytes } from "../../src/lib/offlineFileSystem"
import { feedback, layout } from "../../src/styles/shared"

const HINT_VISIBLE_MS = 4000

export default function LibraryScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const router = useRouter()
  const navigation = useNavigation()
  const {
    offlineRecords,
    isReady,
    deleteDownload,
    retryDownload,
    resumeDownload,
  } = useDownloads()
  const {
    longPressHintSeen,
    setLongPressHintSeen,
    isReady: prefsReady,
  } = useWatchPreferences()

  const [capacityBytes, setCapacityBytes] = useState(0)
  useEffect(() => {
    let cancelled = false
    void totalDiskBytes().then((bytes) => {
      if (!cancelled) setCapacityBytes(bytes)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [selectionState, setSelectionState] = useState<LibrarySelectionState>(
    INITIAL_SELECTION_STATE,
  )
  const { selecting, selected } = selectionState
  const [hintVisible, setHintVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Also gated on prefsReady: before the persisted blob hydrates,
  // longPressHintSeen reads false and the hint would flash for returning users.
  useEffect(() => {
    if (
      !isReady ||
      !prefsReady ||
      offlineRecords.length === 0 ||
      selecting ||
      longPressHintSeen
    ) {
      setHintVisible(false)
      return
    }
    setHintVisible(true)
    const timer = setTimeout(() => setHintVisible(false), HINT_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [isReady, prefsReady, offlineRecords.length, selecting, longPressHintSeen])

  // KTD8: the action bar replaces the tab bar during selection; restored
  // whenever selection turns off, on blur (switching tabs), and on unmount.
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: selecting ? { display: "none" } : TAB_BAR_STYLE,
    })
  }, [selecting, navigation])

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener("blur", () => {
      setSelectionState(exitSelection())
    })
    return () => {
      unsubscribeBlur()
      navigation.setOptions({ tabBarStyle: TAB_BAR_STYLE })
    }
  }, [navigation])

  // R20: prune selected slugs the provider no longer has; auto-exit when empty.
  // Keyed ONLY on offlineRecords (selectionState via ref) — reacting to the
  // user's own checkbox taps would bounce out of selection on deselect-last.
  const selectionStateRef = useRef(selectionState)
  selectionStateRef.current = selectionState
  useEffect(() => {
    if (!selectionStateRef.current.selecting) return
    const existingSlugs = new Set(offlineRecords.map((r) => r.videoSlug))
    const pruned = pruneToExisting(selectionStateRef.current, existingSlugs)
    if (pruned.changed || pruned.autoExit) {
      setSelectionState(pruned.state)
    }
  }, [offlineRecords])

  // The confirm sheet only makes sense mid-selection — force it closed if
  // selection exits out from under it (Cancel, back, or a live prune to empty).
  useEffect(() => {
    if (!selecting) setConfirmVisible(false)
  }, [selecting])

  // Android back: close the confirm sheet first, else exit selection, before
  // falling through to default navigation. Registered only while selecting,
  // so it deregisters itself the moment selection exits.
  useEffect(() => {
    if (!selecting) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (confirmVisible) setConfirmVisible(false)
      else setSelectionState(exitSelection())
      return true
    })
    return () => sub.remove()
  }, [selecting, confirmVisible])

  const navigateToWatch = useCallback(
    (videoSlug: string) =>
      router.push(`/watch/${encodeURIComponent(videoSlug)}` as never),
    [router],
  )

  const handleRowPress = useCallback(
    (videoSlug: string) => {
      if (selecting) {
        setSelectionState((prev) => toggleSlug(prev, videoSlug))
      } else {
        navigateToWatch(videoSlug)
      }
    },
    [selecting, navigateToWatch],
  )

  const handleLongPress = useCallback(
    (slugs: readonly string[]) => {
      setSelectionState((prev) =>
        prev.selecting
          ? toggleSeriesSlugs(prev, slugs, true)
          : enterSelection(slugs),
      )
      setLongPressHintSeen(true)
    },
    [setLongPressHintSeen],
  )

  // Standalone rows long-press a single slug; wrap it once here (stable
  // reference) so passing it straight through doesn't defeat DownloadRow's memo.
  const handleRowLongPress = useCallback(
    (videoSlug: string) => handleLongPress([videoSlug]),
    [handleLongPress],
  )

  const handleSelectPress = () => {
    setSelectionState(enterSelection([]))
    setLongPressHintSeen(true)
  }

  const handleToggleSeries = useCallback((episodeSlugs: readonly string[]) => {
    setSelectionState((prev) => toggleSeriesHeader(prev, episodeSlugs))
  }, [])

  const allSlugs = useMemo(
    () => offlineRecords.map((record) => record.videoSlug),
    [offlineRecords],
  )
  const allSelected = selected.size > 0 && selected.size === allSlugs.length

  const handleToggleSelectAll = () => {
    setSelectionState((prev) =>
      allSelected ? deselectAll(prev) : selectAll(prev, allSlugs),
    )
  }

  const handleDeletePress = () => setConfirmVisible(true)
  const handleCancelDelete = () => setConfirmVisible(false)

  const handleConfirmDelete = useCallback(async () => {
    const slugs = Array.from(selected)
    setConfirmVisible(false)
    const result = await bulkDelete({
      slugs,
      records: offlineRecords,
      deleteDownload,
    })
    datadogLog.info("library.bulk_delete", {
      count: result.deletedCount,
      bytes: result.freedBytes,
      failed: result.failedCount,
    })
    setSelectionState(exitSelection())
    setToastMessage(
      `${result.deletedCount} video${result.deletedCount === 1 ? "" : "s"} deleted · ${formatLibraryBytes(result.freedBytes)} freed${
        result.failedCount > 0
          ? ` · ${result.failedCount} couldn't be deleted`
          : ""
      }`,
    )
  }, [selected, offlineRecords, deleteDownload])

  const handleRetryFailed = useCallback(async () => {
    const slugs = Array.from(selected)
    const count = await retryFailedSelected({
      slugs,
      records: offlineRecords,
      retryDownload,
    })
    datadogLog.info("library.retry_failed", { count })
    setSelectionState(exitSelection())
  }, [selected, offlineRecords, retryDownload])

  // Recompute only when their own inputs change — not on every render (e.g.
  // selection-mode UI churn, toast dismiss) — so an in-flight download's
  // per-tick offlineRecords update is the only thing that rebuilds these.
  const { seriesGroups, standaloneRecords } = useMemo(
    () => buildLibraryViewModel(offlineRecords),
    [offlineRecords],
  )
  const summary = useMemo(
    () => storageSummary(offlineRecords, capacityBytes),
    [offlineRecords, capacityBytes],
  )
  const selection = useMemo(
    () => selectionSummary(selected, offlineRecords),
    [selected, offlineRecords],
  )

  if (!isReady) {
    return (
      <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
        <Text style={[styles.title, typography.heading]}>Library</Text>
      </View>
    )
  }

  const hasRecords = offlineRecords.length > 0

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <View style={styles.headRow}>
          {selecting ? (
            <>
              <Pressable
                onPress={handleToggleSelectAll}
                style={({ pressed }) => [
                  styles.textPill,
                  pressed && feedback.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={allSelected ? "Deselect all" : "Select all"}
              >
                <Text style={styles.textPillLabel}>
                  {allSelected ? "Deselect All" : "Select All"}
                </Text>
              </Pressable>
              <Text style={[styles.selectionCount, typography.body]}>
                {selection.count} selected
              </Text>
              <Pressable
                onPress={() => setSelectionState(exitSelection())}
                style={({ pressed }) => [
                  styles.textPill,
                  pressed && feedback.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cancel selection"
              >
                <Text style={styles.textPillLabel}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.title, typography.heading]}>Library</Text>
              {hasRecords && (
                <Pressable
                  onPress={handleSelectPress}
                  style={({ pressed }) => [
                    styles.selectPill,
                    pressed && feedback.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Select downloads"
                >
                  <Text style={styles.selectPillText}>Select</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
        {summary && <StorageSummary summary={summary} />}
        {hintVisible && (
          <Text style={[styles.hint, typography.caption]}>
            Touch and hold a video to select
          </Text>
        )}
      </View>

      {!hasRecords ? (
        <LibraryEmptyState />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            selecting && styles.scrollContentSelecting,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {seriesGroups.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, typography.caption]}>
                Series
              </Text>
              {seriesGroups.map((group) => (
                <SeriesGroupCard
                  key={group.seriesSlug}
                  group={group}
                  onRowPress={handleRowPress}
                  onRetry={retryDownload}
                  onResume={resumeDownload}
                  selecting={selecting}
                  selected={selected}
                  onToggleSeries={handleToggleSeries}
                  onLongPress={handleLongPress}
                />
              ))}
            </>
          )}
          {standaloneRecords.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, typography.caption]}>
                Videos
              </Text>
              {standaloneRecords.map((record) => (
                <DownloadRow
                  key={record.videoSlug}
                  record={record}
                  variant="standalone"
                  onPress={handleRowPress}
                  onRetry={retryDownload}
                  onResume={resumeDownload}
                  selecting={selecting}
                  selected={selected.has(record.videoSlug)}
                  onLongPress={handleRowLongPress}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      {selecting && (
        <SelectionActionBar
          count={selection.count}
          combinedBytes={selection.combinedBytes}
          hasFailed={selection.hasFailed}
          onRetryFailed={handleRetryFailed}
          onDeletePress={handleDeletePress}
        />
      )}

      <DeleteConfirmSheet
        visible={confirmVisible}
        count={selection.count}
        combinedBytes={selection.combinedBytes}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      <Snackbar
        message={toastMessage ?? ""}
        visible={toastMessage != null}
        onDismiss={() => setToastMessage(null)}
      />
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const PILL_BG = "rgba(255, 255, 255, 0.09)"

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  selectPill: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: PILL_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  selectPillText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
  textPill: {
    height: 34,
    justifyContent: "center",
  },
  textPillLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
  selectionCount: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  hint: {
    marginTop: 10,
    alignSelf: "center",
    color: TEXT_SECONDARY,
    fontFamily: "System",
    backgroundColor: SURFACE_COLOR,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 14,
  },
  sectionLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 12,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  scrollContentSelecting: {
    paddingBottom: 120,
  },
})
