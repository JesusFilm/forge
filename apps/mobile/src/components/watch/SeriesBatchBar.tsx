import { Alert, Pressable, StyleSheet, Text, View } from "react-native"

import { ACCENT, SURFACE_COLOR, TEXT_SECONDARY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import type { SeriesDownloadState } from "../../lib/seriesDownloadAggregate"

type SeriesBatchBarProps = {
  state: SeriesDownloadState
  onPauseAll: () => void
  onResumeAll: () => void
  onCancelAll: () => void
}

/**
 * Slim bar under the series action row while a batch is in flight (U8): "Pause
 * all / Cancel all", flipping to "Resume all / Cancel all" once every episode is
 * paused (pausedAggregate, checked before inProgress). Cancel all confirms and
 * names the count (destructive). Renders nothing when no batch is running.
 */
export function SeriesBatchBar({
  state,
  onPauseAll,
  onResumeAll,
  onCancelAll,
}: SeriesBatchBarProps) {
  const typography = useTypography()
  if (!state.inProgress) return null

  const count = state.inFlightSlugs.length
  const primaryLabel = state.pausedAggregate ? "Resume all" : "Pause all"
  const onPrimary = state.pausedAggregate ? onResumeAll : onPauseAll

  const confirmCancel = () =>
    Alert.alert(
      "Cancel downloads",
      `Cancel ${count} download${count === 1 ? "" : "s"} for this series?`,
      [
        { text: "Cancel all", style: "destructive", onPress: onCancelAll },
        { text: "Keep", style: "cancel" },
      ],
    )

  return (
    <View style={styles.bar}>
      <Text style={[styles.label, typography.caption]} numberOfLines={1}>
        {state.pausedAggregate ? "Paused" : "Downloading"} {state.downloaded} of{" "}
        {state.total}
      </Text>
      <Pressable
        onPress={onPrimary}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
      >
        <Text style={[styles.action, typography.caption]}>{primaryLabel}</Text>
      </Pressable>
      <Text style={[styles.sep, typography.caption]}>·</Text>
      <Pressable
        onPress={confirmCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel all downloads"
      >
        <Text style={[styles.actionDanger, typography.caption]}>
          Cancel all
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: SURFACE_COLOR,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  action: {
    color: ACCENT,
    fontFamily: "System",
    fontWeight: "600",
  },
  actionDanger: {
    color: ACCENT,
    fontFamily: "System",
    fontWeight: "600",
  },
  sep: {
    color: TEXT_SECONDARY,
  },
})
