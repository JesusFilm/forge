import { type ComponentProps } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { BLACK, SURFACE_COLOR, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { EpisodeBadgeState } from "../../lib/seriesDownloadAggregate"

// Grid corner badge per download state (U9). Also spoken via accessibilityLabel.
const BADGE: Record<
  Exclude<EpisodeBadgeState, "none">,
  { icon: ComponentProps<typeof Ionicons>["name"]; color: string; a11y: string }
> = {
  saved: { icon: "checkmark-circle", color: "#34d399", a11y: "saved offline" },
  downloading: {
    icon: "arrow-down-circle",
    color: "#ffffff",
    a11y: "downloading",
  },
  queued: {
    icon: "ellipsis-horizontal-circle",
    color: "rgba(255,255,255,0.75)",
    a11y: "queued",
  },
  paused: { icon: "pause-circle", color: "#f5c451", a11y: "paused" },
}

type SeriesEpisodeCardProps = {
  episode: WatchEpisode
  onSelect: (episode: WatchEpisode) => void
  /** Per-episode offline state driving the corner badge (U9). */
  downloadState?: EpisodeBadgeState
}

// A single video in the series grid. 4:3 thumbnail + title, mirroring
// SearchResultCard. A static image — never a player — so the grid holds no
// hardware decoder slots (only the hero does).
export function SeriesEpisodeCard({
  episode,
  onSelect,
  downloadState,
}: SeriesEpisodeCardProps) {
  const imageUrl = resolveImageUrl(episode.posterUrl)
  const badge =
    downloadState && downloadState !== "none" ? BADGE[downloadState] : null
  const title = episode.title ?? "Episode"

  return (
    <View style={styles.cardOuter}>
      <Pressable
        onPress={() => onSelect(episode)}
        accessibilityRole="button"
        accessibilityLabel={badge ? `${title}, ${badge.a11y}` : title}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.thumb}>
          {imageUrl ? (
            <Image
              source={imageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={episode.documentId}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text style={styles.placeholderIcon}>▶</Text>
            </View>
          )}

          <LinearGradient
            colors={[hexToRgba(BLACK, 0), "rgba(0,0,0,0.25)", BLACK]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />

          {episode.title ? (
            <View style={styles.titleOverlay}>
              <Text style={styles.title} numberOfLines={2}>
                {episode.title}
              </Text>
            </View>
          ) : null}

          {badge ? (
            <View style={styles.badge}>
              <Ionicons name={badge.icon} size={16} color={badge.color} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  cardOuter: {
    flex: 1,
    margin: 6,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.85,
  },
  thumb: {
    aspectRatio: 4 / 3,
    width: "100%",
    backgroundColor: SURFACE_COLOR,
  },
  placeholder: {
    backgroundColor: SURFACE_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderIcon: {
    fontSize: 32,
    color: "rgba(255,255,255,0.3)",
  },
  titleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  title: {
    color: "#ffffff",
    fontFamily: "System",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 17,
  },
  badge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
})
