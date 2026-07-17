import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { BrowseTopic } from "../../lib/browseTopics"
import { hexToRgba, TEXT_ON_OVERLAY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { feedback } from "../../styles/shared"

// Cinematic top + bottom darkening — fixed across all cards, so compute once.
const SCRIM_COLORS = [
  hexToRgba("#000000", 0.4),
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.65),
] as const

// expo-image's blurRadius isn't calibrated equally across platforms — the same
// value blurs noticeably harder on Android than iOS — so bump iOS to match.
const THUMBNAIL_BLUR_RADIUS = Platform.OS === "ios" ? 12 : 4

export interface TopicCardProps {
  topic: BrowseTopic
  onSelect: (searchTerm: string) => void
  /** First search result's thumbnail, rendered faintly over the gradient. */
  thumbnailUrl?: string | null
  /** Explicit width set by the grid so two cards sit per row. */
  cardWidth: number
}

// Browse-category grid card mirroring the "Discover Categories Grid Card"
// design: gradient fill, bottom scrim for legibility, glyph top-left, label
// bottom-left. The Pressable owns touch + a11y; the glyph is decorative.
export function TopicCard({
  topic,
  onSelect,
  thumbnailUrl,
  cardWidth,
}: TopicCardProps) {
  const typography = useTypography()

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { width: cardWidth },
        pressed && feedback.pressed,
      ]}
      onPress={() => onSelect(topic.searchTerm)}
      accessibilityRole="button"
      accessibilityLabel={`Search ${topic.label}`}
    >
      <LinearGradient
        colors={[...topic.gradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {thumbnailUrl ? (
        <Image
          source={thumbnailUrl}
          style={[StyleSheet.absoluteFill, styles.thumbnail]}
          contentFit="cover"
          blurRadius={THUMBNAIL_BLUR_RADIUS}
          transition={400}
          cachePolicy="memory-disk"
          recyclingKey={topic.searchTerm}
        />
      ) : null}
      <LinearGradient
        colors={[...SCRIM_COLORS]}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={styles.iconWrap}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={topic.glyph} size={26} color={TEXT_ON_OVERLAY} />
      </View>
      <Text style={[styles.label, typography.titleSmall]} numberOfLines={1}>
        {topic.label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1.05,
    borderRadius: 20,
    overflow: "hidden",
    justifyContent: "flex-end",
    padding: 14,
  },
  thumbnail: {
    opacity: 0.3,
  },
  iconWrap: {
    position: "absolute",
    top: 14,
    left: 14,
  },
  label: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
})
