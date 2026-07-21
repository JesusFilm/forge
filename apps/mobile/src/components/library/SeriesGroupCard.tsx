import { memo, useCallback, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import {
  STATUS_FAILED_COLOR,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import {
  formatLibraryBytes,
  type LibrarySeriesGroup,
} from "../../lib/libraryDownloads"
import {
  seriesSelectionState,
  type SeriesSelectionState,
} from "../../lib/librarySelection"
import { feedback } from "../../styles/shared"
import { AnimatedChevron, animateLayout } from "../ui/AnimatedChevron"
import { DownloadRow } from "./DownloadRow"
import { SelectionCheckbox } from "./SelectionCheckbox"

const THUMB_GRADIENT: readonly [string, string] = ["#4a3428", "#1a1210"]
const STACK_ICON_COLOR = "rgba(255, 255, 255, 0.85)"
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export interface SeriesGroupCardProps {
  group: LibrarySeriesGroup
  onRowPress: (videoSlug: string) => void
  onRetry: (videoSlug: string) => void
  onResume: (videoSlug: string) => void
  /** Selection mode (R11): header shows an all/some/none checkbox and toggles the whole series. */
  selecting?: boolean
  selected?: ReadonlySet<string>
  onToggleSeries?: (episodeSlugs: readonly string[]) => void
  onLongPress?: (episodeSlugs: readonly string[]) => void
}

/** Collapsible series card (R4). Defaults collapsed; tapping the header toggles expansion. */
export const SeriesGroupCard = memo(function SeriesGroupCard({
  group,
  onRowPress,
  onRetry,
  onResume,
  selecting = false,
  selected = EMPTY_SELECTION,
  onToggleSeries,
  onLongPress,
}: SeriesGroupCardProps) {
  const typography = useTypography()
  const [expanded, setExpanded] = useState(false)
  const posterPath = group.episodes[0]?.posterPath ?? null
  const episodeSlugs = group.episodes.map((episode) => episode.videoSlug)
  const seriesState: SeriesSelectionState = selecting
    ? seriesSelectionState(episodeSlugs, selected)
    : "none"

  const handleToggle = () => {
    if (selecting) {
      onToggleSeries?.(episodeSlugs)
      return
    }
    animateLayout()
    setExpanded((prev) => !prev)
  }

  // One stable callback shared by every episode row (not one per .map()
  // iteration) so React.memo(DownloadRow) can actually bail on this prop.
  const handleEpisodeLongPress = useCallback(
    (slug: string) => onLongPress?.([slug]),
    [onLongPress],
  )

  return (
    <View style={styles.card}>
      <Pressable
        onPress={handleToggle}
        onLongPress={() => onLongPress?.(episodeSlugs)}
        style={({ pressed }) => [styles.header, pressed && feedback.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${group.seriesTitle}, ${group.episodeCount} videos`}
        accessibilityState={selecting ? undefined : { expanded }}
      >
        {selecting && <SelectionCheckbox state={seriesState} />}
        <View style={styles.thumb}>
          {posterPath ? (
            <Image
              source={posterPath}
              style={styles.thumbImage}
              contentFit="cover"
              recyclingKey={group.seriesSlug}
            />
          ) : (
            <LinearGradient colors={THUMB_GRADIENT} style={styles.thumbImage} />
          )}
          <View style={styles.stackBadge} pointerEvents="none">
            <Ionicons
              name="albums-outline"
              size={18}
              color={STACK_ICON_COLOR}
            />
          </View>
        </View>

        <View style={styles.info}>
          <Text style={[styles.title, typography.titleSmall]} numberOfLines={1}>
            {group.seriesTitle}
          </Text>
          <Text style={[styles.meta, typography.caption]} numberOfLines={1}>
            {group.episodeCount} videos ·{" "}
            {formatLibraryBytes(group.combinedBytes)}
            {group.failedEpisodeCount > 0 && (
              <Text style={styles.metaFailed}>
                {" "}
                · {group.failedEpisodeCount} failed
              </Text>
            )}
          </Text>
        </View>

        <AnimatedChevron
          isExpanded={expanded}
          glyph="›"
          style={styles.chevron}
        />
      </Pressable>

      {expanded &&
        group.episodes.map((episode) => (
          <DownloadRow
            key={episode.videoSlug}
            record={episode}
            variant="grouped"
            onPress={onRowPress}
            onRetry={onRetry}
            onResume={onResume}
            selecting={selecting}
            selected={selected.has(episode.videoSlug)}
            onLongPress={handleEpisodeLongPress}
          />
        ))}
    </View>
  )
})

const styles = StyleSheet.create({
  card: {
    backgroundColor: SURFACE_COLOR,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: THUMB_GRADIENT[1],
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  stackBadge: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "700",
  },
  meta: {
    marginTop: 3,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "500",
  },
  metaFailed: {
    color: STATUS_FAILED_COLOR,
    fontWeight: "700",
  },
  chevron: {
    color: TEXT_SECONDARY,
    fontSize: 20,
  },
})
