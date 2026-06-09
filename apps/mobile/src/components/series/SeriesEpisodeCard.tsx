import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { BLACK, SURFACE_COLOR, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"

type SeriesEpisodeCardProps = {
  episode: WatchEpisode
  onSelect: (episode: WatchEpisode) => void
}

// A single video in the series grid. 4:3 thumbnail + title, mirroring
// SearchResultCard. A static image — never a player — so the grid holds no
// hardware decoder slots (only the hero does).
export function SeriesEpisodeCard({
  episode,
  onSelect,
}: SeriesEpisodeCardProps) {
  const imageUrl = resolveImageUrl(episode.posterUrl)

  return (
    <View style={styles.cardOuter}>
      <Pressable
        onPress={() => onSelect(episode)}
        accessibilityRole="button"
        accessibilityLabel={episode.title ?? "Episode"}
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
})
