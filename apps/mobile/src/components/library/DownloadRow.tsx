import { memo, useMemo } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  STATUS_DONE_COLOR,
  STATUS_FAILED_COLOR,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  formatLibraryDuration,
  libraryRowState,
} from "../../lib/libraryDownloads"
import type { OfflineDownloadRecord } from "../../lib/offlineManifest"
import { feedback } from "../../styles/shared"
import { DownloadProgressRing } from "../watch/DownloadProgressRing"
import { SelectionCheckbox } from "./SelectionCheckbox"

const RING_TRACK_COLOR = "rgba(255, 255, 255, 0.18)"
const THUMB_GRADIENT: readonly [string, string] = ["#2a2f37", "#15171c"]
const GROUPED_DIVIDER_COLOR = "rgba(255, 255, 255, 0.09)"

/** Humanize a video slug as a title fallback when the record has no stored title. */
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export interface DownloadRowProps {
  record: OfflineDownloadRecord
  /** "standalone" rows are their own card; "grouped" rows render flush inside a SeriesGroupCard. */
  variant: "standalone" | "grouped"
  onPress: (videoSlug: string) => void
  onRetry: (videoSlug: string) => void
  onResume: (videoSlug: string) => void
  /** Selection mode (R11): shows a checkbox instead of the status affordance; tap toggles via onPress. */
  selecting?: boolean
  selected?: boolean
  onLongPress?: (videoSlug: string) => void
}

/**
 * One offline download's Library row: poster, title, status subtitle, and its
 * rowState affordance (R5/R6/R8). rowState derives from `record` HERE (not a
 * parent-computed prop) so React.memo's `record`-identity check is the one
 * thing that decides whether this row re-renders on a progress tick.
 */
export const DownloadRow = memo(function DownloadRow({
  record,
  variant,
  onPress,
  onRetry,
  onResume,
  selecting = false,
  selected = false,
  onLongPress,
}: DownloadRowProps) {
  const typography = useTypography()
  const title = record.title || slugToTitle(record.videoSlug)
  const duration = formatLibraryDuration(record.durationSeconds)
  const rowState = useMemo(() => libraryRowState(record), [record])
  const failed = rowState.affordance === "retry"

  return (
    <Pressable
      onPress={() => onPress(record.videoSlug)}
      onLongPress={() => onLongPress?.(record.videoSlug)}
      style={({ pressed }) => [
        styles.row,
        variant === "standalone" ? styles.rowStandalone : styles.rowGrouped,
        pressed && feedback.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${rowState.subtitle}`}
      accessibilityState={selecting ? { selected } : undefined}
    >
      {selecting && <SelectionCheckbox state={selected} />}
      <View style={styles.thumb}>
        {record.posterPath ? (
          <Image
            source={record.posterPath}
            style={styles.thumbImage}
            contentFit="cover"
            recyclingKey={record.videoSlug}
          />
        ) : (
          <LinearGradient colors={THUMB_GRADIENT} style={styles.thumbImage} />
        )}
        {duration != null && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={[styles.title, typography.body]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[
            styles.subtitle,
            typography.caption,
            failed && styles.subtitleFailed,
          ]}
          numberOfLines={1}
        >
          {rowState.subtitle}
        </Text>
      </View>

      {!selecting && rowState.affordance !== "none" && (
        <View style={styles.side}>
          {rowState.affordance === "check" && (
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={STATUS_DONE_COLOR}
            />
          )}
          {rowState.affordance === "ring" && (
            <DownloadProgressRing
              size={26}
              strokeWidth={2.5}
              progress={rowState.progress ?? 0}
              color={ACCENT}
              trackColor={RING_TRACK_COLOR}
              cutoutColor={SURFACE_COLOR}
            />
          )}
          {rowState.affordance === "resume" && (
            <Pressable
              hitSlop={8}
              onPress={() => onResume(record.videoSlug)}
              style={styles.affordanceButton}
              accessibilityRole="button"
              accessibilityLabel={`Resume ${title}`}
            >
              <Ionicons name="play" size={18} color={ACCENT} />
            </Pressable>
          )}
          {rowState.affordance === "retry" && (
            <Pressable
              hitSlop={8}
              onPress={() => onRetry(record.videoSlug)}
              style={styles.affordanceButton}
              accessibilityRole="button"
              accessibilityLabel={`Retry ${title}`}
            >
              <Ionicons name="refresh" size={18} color={ACCENT} />
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowStandalone: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: 18,
    padding: 13,
    marginBottom: 12,
  },
  rowGrouped: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: GROUPED_DIVIDER_COLOR,
  },
  thumb: {
    width: 88,
    height: 50,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: THUMB_GRADIENT[1],
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  durationBadge: {
    position: "absolute",
    right: 5,
    bottom: 5,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    // Static (not screen-scaled) — round to a whole px, matching the
    // codebase's Android sub-pixel-blur rule for any fixed font size.
    fontSize: 11,
    fontWeight: "700",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  subtitle: {
    marginTop: 3,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "500",
  },
  subtitleFailed: {
    color: STATUS_FAILED_COLOR,
    fontWeight: "600",
  },
  side: {
    flexShrink: 0,
  },
  affordanceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
})
