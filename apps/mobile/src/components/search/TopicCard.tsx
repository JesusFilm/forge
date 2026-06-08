import { Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { BrowseTopic } from "../../lib/browseTopics"
import { hexToRgba, TEXT_ON_OVERLAY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { feedback } from "../../styles/shared"

export interface TopicCardProps {
  topic: BrowseTopic
  onSelect: (searchTerm: string) => void
  /** First search result's thumbnail, rendered faintly over the gradient. */
  thumbnailUrl?: string | null
}

// A browse-category grid card. A vivid two-stop gradient fills the card, a
// bottom scrim keeps the label legible, a white outline glyph sits top-left, and
// the label sits bottom-left — mirroring the "Discover Categories Grid Card"
// design. The Pressable owns touch + a11y; the glyph is decorative.
export function TopicCard({ topic, onSelect, thumbnailUrl }: TopicCardProps) {
  const typography = useTypography()

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && feedback.pressed]}
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
          transition={400}
          recyclingKey={topic.searchTerm}
        />
      ) : null}
      <LinearGradient
        colors={[hexToRgba("#000000", 0), hexToRgba("#000000", 0.55)]}
        start={{ x: 0.5, y: 0.35 }}
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
    flexGrow: 1,
    flexBasis: "45%",
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
