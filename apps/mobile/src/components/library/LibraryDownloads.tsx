import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useIsFocused, useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  TAB_BAR_HEIGHT_IOS,
  useTabBarClearance,
  useTabBarStyle,
} from "../../lib/tabBar"
import { resetTabBarHidden, setTabBarHidden } from "../../lib/tabBarVisibility"

import { DeleteConfirmSheet } from "./DeleteConfirmSheet"
import { DownloadRow } from "./DownloadRow"
import { DownloadsSummary } from "./DownloadsSummary"
import { LibraryEmptyState } from "./LibraryEmptyState"
import { SelectionActionBar } from "./SelectionActionBar"
import { SeriesGroupCard } from "./SeriesGroupCard"
import { Snackbar } from "../ui/Snackbar"
import { useDownloads } from "../../contexts/DownloadsProvider"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { useTypography } from "../../hooks/useTypography"
import {
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { datadogLog } from "../../lib/datadog"
import { bulkDelete, retryFailedSelected } from "../../lib/libraryBulkActions"
import {
  buildLibraryViewModel,
  formatLibraryBytes,
} from "../../lib/libraryDownloads"
import { useNonRouteSheetSuppression } from "../../hooks/useNonRouteSheetSuppression"
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
} from "../../lib/librarySelection"
import { feedback, layout } from "../../styles/shared"

const HINT_VISIBLE_MS = 4000

export type LibraryDownloadsProps = {
  /** Scrolls above the downloads. The Profile tab puts its account card here. */
  header?: ReactNode
  /** Leads the Select row; selection mode needs that row for its controls. */
  title?: string
  /** Ends the scroll content. The Profile tab puts its privacy link here. */
  footer?: ReactNode
}

/**
 * The downloads library as a whole tab screen. The Profile tab renders it
 * under the account card; there is no separate Library tab.
 */
export function LibraryDownloads({
  header,
  title,
  footer,
}: LibraryDownloadsProps) {
  const insets = useSafeAreaInsets()
  const tabBarStyle = useTabBarStyle()
  const tabBarClearance = useTabBarClearance()
  const typography = useTypography()
  const router = useRouter()
  const navigation = useNavigation()
  const isFocused = useIsFocused()
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

  const [selectionState, setSelectionState] = useState<LibrarySelectionState>(
    INITIAL_SELECTION_STATE,
  )
  const { selecting, selected } = selectionState
  // The iOS action bar stands where the native tab bar did, but hiding that bar
  // drops the bar height out of insets.bottom — so add it back here.
  const selectionPad = selecting
    ? Platform.OS === "android"
      ? 120
      : TAB_BAR_HEIGHT_IOS + 24
    : 24
  const [hintVisible, setHintVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Gated on prefsReady because longPressHintSeen reads false before the
  // persisted blob hydrates. Gated on focus because every tab mounts at cold
  // launch, and the timer would expire while another tab is on screen.
  useEffect(() => {
    if (
      !isFocused ||
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
  }, [
    isFocused,
    isReady,
    prefsReady,
    offlineRecords.length,
    selecting,
    longPressHintSeen,
  ])

  // KTD8: the action bar replaces the tab bar during selection; restored
  // whenever selection turns off, on blur (switching tabs), and on unmount.
  //
  // Two mechanisms, because the two navigators take different levers. Android's
  // JS bar hides per screen through `setOptions`; iOS runs a UITabBarController
  // whose only hide lever is the navigator-level `hidden` prop, so the flag has
  // to travel UP to `_layout.ios.tsx` through the module store.
  useEffect(() => {
    setTabBarHidden(selecting)
    if (Platform.OS === "ios") return
    navigation.setOptions({
      tabBarStyle: selecting ? { display: "none" } : tabBarStyle,
    })
  }, [selecting, navigation, tabBarStyle])

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener("blur", () => {
      setSelectionState(exitSelection())
    })
    return () => {
      unsubscribeBlur()
      resetTabBarHidden()
      if (Platform.OS === "ios") return
      navigation.setOptions({ tabBarStyle })
    }
  }, [navigation, tabBarStyle])

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

  useNonRouteSheetSuppression(confirmVisible, "libraryDeleteConfirm")

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
  const selection = useMemo(
    () => selectionSummary(selected, offlineRecords),
    [selected, offlineRecords],
  )

  const hasHeader = header != null
  const hasRecords = isReady && offlineRecords.length > 0

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: selectionPad + tabBarClearance,
        }}
        // A header scrolls away; the head pins under it so Select and Cancel
        // stay in reach however far the list scrolls.
        stickyHeaderIndices={hasRecords ? [hasHeader ? 1 : 0] : undefined}
        showsVerticalScrollIndicator={false}
      >
        {hasHeader && <View style={styles.header}>{header}</View>}

        {/* Selection and the hint both need records, so the whole head does. */}
        {hasRecords && (
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
                    accessibilityLabel={
                      allSelected ? "Deselect all" : "Select all"
                    }
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
                  {title != null && (
                    <Text
                      style={[styles.title, typography.titleSmall]}
                      numberOfLines={1}
                      accessibilityRole="header"
                    >
                      {title}
                    </Text>
                  )}
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
                </>
              )}
            </View>
            <DownloadsSummary count={offlineRecords.length} />
            {hintVisible && (
              <Text style={[styles.hint, typography.caption]}>
                Touch and hold a video to select
              </Text>
            )}
          </View>
        )}

        {/* Before the manifest hydrates, show neither the list nor the empty state. */}
        {isReady &&
          (hasRecords ? (
            <View style={styles.list}>
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
            </View>
          ) : (
            <LibraryEmptyState
              style={hasHeader ? styles.emptyUnderHeader : undefined}
            />
          ))}

        {footer != null && <View style={styles.footer}>{footer}</View>}
      </ScrollView>

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
        clearsTabBar
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
  header: {
    paddingTop: 16,
  },
  head: {
    // Opaque because the head pins over the rows scrolling under it.
    backgroundColor: BG_COLOR,
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
    flexShrink: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  selectPill: {
    // Often alone in a space-between row, so push it to the trailing edge.
    marginLeft: "auto",
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
  list: {
    paddingHorizontal: 16,
  },
  emptyUnderHeader: {
    paddingTop: 24,
  },
  footer: {
    // With the content grown to the screen height, a short page rests the
    // footer at the bottom; a long list pushes it past the last row.
    marginTop: "auto",
    paddingTop: 32,
    alignItems: "center",
  },
})
