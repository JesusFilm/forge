import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { DownloadRow } from "../../src/components/library/DownloadRow"
import { LibraryEmptyState } from "../../src/components/library/LibraryEmptyState"
import { SeriesGroupCard } from "../../src/components/library/SeriesGroupCard"
import { StorageSummary } from "../../src/components/library/StorageSummary"
import { useDownloads } from "../../src/contexts/DownloadsProvider"
import { useWatchPreferences } from "../../src/contexts/WatchPreferencesProvider"
import { useTypography } from "../../src/hooks/useTypography"
import {
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../src/lib/color"
import {
  buildLibraryViewModel,
  libraryRowState,
  storageSummary,
} from "../../src/lib/libraryDownloads"
import { totalDiskBytes } from "../../src/lib/offlineFileSystem"
import { feedback, layout } from "../../src/styles/shared"

const HINT_VISIBLE_MS = 4000

export default function LibraryScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const router = useRouter()
  const {
    offlineRecords,
    pendingSwapSlugs,
    isReady,
    retryDownload,
    resumeDownload,
  } = useDownloads()
  const { longPressHintSeen, setLongPressHintSeen } = useWatchPreferences()

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

  // U5 owns the selection machine; this flag exists here only to suppress the
  // long-press hint once the user has entered selection mode.
  const [selecting, setSelecting] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)

  useEffect(() => {
    if (
      !isReady ||
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
  }, [isReady, offlineRecords.length, selecting, longPressHintSeen])

  const navigateToWatch = useCallback(
    (videoSlug: string) =>
      router.push(`/watch/${encodeURIComponent(videoSlug)}` as never),
    [router],
  )

  const handleSelectPress = () => {
    // U5: selection-mode header, checkboxes, action bar
    setSelecting(true)
    setLongPressHintSeen(true)
  }

  if (!isReady) {
    return (
      <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
        <Text style={[styles.title, typography.heading]}>Library</Text>
      </View>
    )
  }

  const hasRecords = offlineRecords.length > 0
  const { seriesGroups, standaloneRecords } =
    buildLibraryViewModel(offlineRecords)
  const summary = storageSummary(offlineRecords, capacityBytes)

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <View style={styles.headRow}>
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
          contentContainerStyle={styles.scrollContent}
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
                  pendingSwapSlugs={pendingSwapSlugs}
                  onRowPress={navigateToWatch}
                  onRetry={retryDownload}
                  onResume={resumeDownload}
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
                  rowState={libraryRowState(
                    record,
                    pendingSwapSlugs.has(record.videoSlug),
                  )}
                  variant="standalone"
                  onPress={navigateToWatch}
                  onRetry={retryDownload}
                  onResume={resumeDownload}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
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
})
