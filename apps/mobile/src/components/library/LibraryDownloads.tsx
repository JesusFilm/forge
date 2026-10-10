import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"
import { useIsFocused, useNavigation, useRouter } from "expo-router"

import { DeleteConfirmSheet } from "./DeleteConfirmSheet"
import { DownloadRow } from "./DownloadRow"
import { DownloadsSummary } from "./DownloadsSummary"
import { LibraryEmptyState } from "./LibraryEmptyState"
import { SelectionActionBar } from "./SelectionActionBar"
import { SeriesGroupCard } from "./SeriesGroupCard"
import { ScreenTopBar } from "../ui/ScreenTopBar"
import { Snackbar } from "../ui/Snackbar"
import { useDownloads } from "../../contexts/DownloadsProvider"
import { useWatchPreferences } from "../../contexts/WatchPreferencesProvider"
import { useTypography } from "../../hooks/useTypography"
import { useT } from "../../i18n/useT"
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
import { useMiniPlayerBottomClearance } from "../../hooks/useMiniPlayerBottomClearance"
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
import { feedback, layout, text } from "../../styles/shared"

const HINT_VISIBLE_MS = 4000
const LIST_END_GAP = 24

export type LibraryDownloadsProps = {
  /** A series slug to open and scroll to once, from `/downloads?series=`. */
  focusSeriesSlug?: string
}

/** Kept as data, so the toast takes the UI language at render. */
type DeleteResult = {
  deletedCount: number
  freedBytes: number
  failedCount: number
}

type FocusLayout = {
  headHeight: number | null
  listY: number | null
  /** Each card's y inside the list, keyed by series slug. */
  cardY: Map<string, number>
}

/** The full downloads list, with its top bar, selection mode and deletion.
 *  Its one host is the root `app/downloads.tsx` route. */
export function LibraryDownloads({ focusSeriesSlug }: LibraryDownloadsProps) {
  const typography = useTypography()
  const t = useT("Library")
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
  // The selection bar is shorter than the mini player's band, so selection
  // adds nothing to this pad.
  const bottomPad = useMiniPlayerBottomClearance() + LIST_END_GAP
  const [hintVisible, setHintVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null)

  // Gated on prefsReady because longPressHintSeen reads false before the
  // persisted blob hydrates. Gated on focus so the timer does not run out
  // under a screen pushed on top of this one.
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

  // A screen pushed on top must not inherit selection: the back handler below
  // stays registered while selecting and would take that screen's back press.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        setSelectionState(exitSelection())
      }),
    [navigation],
  )

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

  // POP_TO the existing tab navigator; its new `screen: "index"` param selects
  // Home. With no (tabs) below, dismissTo replaces this screen with one.
  const handleBrowse = () => router.dismissTo("/(tabs)")

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
    setDeleteResult({
      deletedCount: result.deletedCount,
      freedBytes: result.freedBytes,
      failedCount: result.failedCount,
    })
  }, [selected, offlineRecords, deleteDownload])

  const toastMessage =
    deleteResult == null
      ? null
      : t(
          deleteResult.failedCount > 0
            ? "deletedWithFailuresToast"
            : "deletedToast",
          {
            count: deleteResult.deletedCount,
            size: formatLibraryBytes(deleteResult.freedBytes),
            failed: deleteResult.failedCount,
          },
        )

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

  // KTD5: open at `focusSeriesSlug` once, with no animation, as app/mission.tsx
  // does for `?section=`. Layout events arrive in no fixed order, so each one
  // records its value and retries until all three are known.
  const scrollRef = useRef<ScrollView>(null)
  const focusLayoutRef = useRef<FocusLayout>({
    headHeight: null,
    listY: null,
    cardY: new Map(),
  })
  const focusRef = useRef(focusSeriesSlug)
  focusRef.current = focusSeriesSlug
  const seriesGroupsRef = useRef(seriesGroups)
  seriesGroupsRef.current = seriesGroups
  const didFocusRef = useRef(false)

  const scrollToFocusedSeries = useCallback(() => {
    const slug = focusRef.current
    const { headHeight, listY, cardY } = focusLayoutRef.current
    // A deleted series keeps its last recorded y; never scroll to that.
    const present = seriesGroupsRef.current.some((g) => g.seriesSlug === slug)
    const y = slug == null ? undefined : cardY.get(slug)
    if (didFocusRef.current || !present || y == null) return
    if (headHeight == null || listY == null) return
    didFocusRef.current = true
    // The Select row pins over the top of the viewport; land the card under it.
    scrollRef.current?.scrollTo({
      y: Math.max(0, listY + y - headHeight),
      animated: false,
    })
  }, [])

  // Re-arm only for a CHANGED value on a reused screen. At mount a layout event
  // can beat this effect, and re-arming then would scroll a second time.
  const armedSlugRef = useRef(focusSeriesSlug)
  useEffect(() => {
    if (armedSlugRef.current === focusSeriesSlug) return
    armedSlugRef.current = focusSeriesSlug
    didFocusRef.current = false
    scrollToFocusedSeries()
  }, [focusSeriesSlug, scrollToFocusedSeries])

  const handleHeadLayout = useCallback(
    (event: LayoutChangeEvent) => {
      focusLayoutRef.current.headHeight = event.nativeEvent.layout.height
      scrollToFocusedSeries()
    },
    [scrollToFocusedSeries],
  )
  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      focusLayoutRef.current.listY = event.nativeEvent.layout.y
      scrollToFocusedSeries()
    },
    [scrollToFocusedSeries],
  )
  const handleCardLayout = useCallback(
    (seriesSlug: string, y: number) => {
      focusLayoutRef.current.cardY.set(seriesSlug, y)
      scrollToFocusedSeries()
    },
    [scrollToFocusedSeries],
  )

  const hasRecords = isReady && offlineRecords.length > 0

  return (
    <View style={layout.screenContainer}>
      {/* Inside this root so the delete sheet's scrim dims it too. */}
      <ScreenTopBar title={t("downloadsTitle")} showBack />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomPad }}
        // The head pins so Select and Cancel stay in reach however far the
        // list scrolls. It must stay the FIRST child for this index to hold.
        stickyHeaderIndices={hasRecords ? [0] : undefined}
        showsVerticalScrollIndicator={false}
      >
        {/* Selection and the hint both need records, so the whole head does. */}
        {hasRecords && (
          <View style={styles.head} onLayout={handleHeadLayout}>
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
                      allSelected
                        ? t("deselectAllAriaLabel")
                        : t("selectAllAriaLabel")
                    }
                    {...{ "dd-action-name": "library-select-all" }}
                  >
                    <Text style={[styles.textPillLabel, typography.bodySmall]}>
                      {allSelected ? t("deselectAll") : t("selectAll")}
                    </Text>
                  </Pressable>
                  <Text style={[styles.selectionCount, typography.body]}>
                    {t("selectedCount", { count: selection.count })}
                  </Text>
                  <Pressable
                    onPress={() => setSelectionState(exitSelection())}
                    style={({ pressed }) => [
                      styles.textPill,
                      pressed && feedback.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t("cancelSelectionAriaLabel")}
                    {...{ "dd-action-name": "library-cancel-selection" }}
                  >
                    <Text style={[styles.textPillLabel, typography.bodySmall]}>
                      {t("cancel")}
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={handleSelectPress}
                  style={({ pressed }) => [
                    styles.selectPill,
                    pressed && feedback.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t("selectDownloadsAriaLabel")}
                  {...{ "dd-action-name": "library-select" }}
                >
                  <Text style={[styles.selectPillText, typography.bodySmall]}>
                    {t("select")}
                  </Text>
                </Pressable>
              )}
            </View>
            <DownloadsSummary count={offlineRecords.length} />
            {hintVisible && (
              <Text style={[styles.hint, typography.caption]}>
                {t("longPressHint")}
              </Text>
            )}
          </View>
        )}

        {/* Before the manifest hydrates, show neither the list nor the empty state. */}
        {isReady &&
          (hasRecords ? (
            <View style={styles.list} onLayout={handleListLayout}>
              {seriesGroups.length > 0 && (
                <>
                  <Text
                    style={[
                      text.eyebrow,
                      styles.sectionLabel,
                      typography.caption,
                    ]}
                  >
                    {t("seriesSection")}
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
                      initiallyExpanded={group.seriesSlug === focusSeriesSlug}
                      onCardLayout={handleCardLayout}
                    />
                  ))}
                </>
              )}
              {standaloneRecords.length > 0 && (
                <>
                  <Text
                    style={[
                      text.eyebrow,
                      styles.sectionLabel,
                      typography.caption,
                    ]}
                  >
                    {t("videosSection")}
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
            <LibraryEmptyState onBrowse={handleBrowse} />
          ))}
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
        message={toastMessage ?? ""}
        visible={toastMessage != null}
        onDismiss={() => setDeleteResult(null)}
      />
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const PILL_BG = "rgba(255, 255, 255, 0.09)"

const styles = StyleSheet.create({
  head: {
    // Opaque because the head pins over the rows scrolling under it.
    backgroundColor: BG_COLOR,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headRow: {
    flexDirection: "row",
    // At a large text size, Cancel moves to a new line, not off screen.
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  // The pills set a minimum height, not a height, so a large text size
  // grows them instead of clipping the label.
  selectPill: {
    // Alone in a space-between row, so push it to the trailing edge.
    marginLeft: "auto",
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: PILL_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  selectPillText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  textPill: {
    minHeight: 34,
    justifyContent: "center",
  },
  textPillLabel: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
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
  // Type comes from text.eyebrow, as on More's group titles.
  sectionLabel: {
    marginTop: 8,
    marginBottom: 12,
  },
  list: {
    paddingHorizontal: 16,
  },
})
