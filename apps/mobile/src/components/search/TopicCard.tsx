import { Platform, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { BrowseTopic } from "../../lib/browseTopics"
import { hexToRgba, TEXT_ON_OVERLAY } from "../../lib/color"
import { stretchedDecodeStyle } from "../../lib/stretchedDecode"
import { useTypography } from "../../hooks/useTypography"
import { useT } from "../../i18n/useT"
import { feedback } from "../../styles/shared"

// Cinematic top + bottom darkening — fixed across all cards, so compute once.
const SCRIM_COLORS = [
  hexToRgba("#000000", 0.4),
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.65),
] as const

// iOS only. On Android, expo-image blurs with RenderScript, and the six cards
// blur at the same time, which can crash the app (feat-784).
const IOS_THUMBNAIL_BLUR_RADIUS = 12
// Android stretches a decode 15 times smaller instead: 16.5 px per bitmap
// pixel. That matches the old Android blur (radius 4, Glide sampling 4).
const ANDROID_THUMBNAIL_SHRINK = 15
const CARD_ASPECT_RATIO = 1.05

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
  const t = useT("BrowseTopics")
  const label = t(topic.labelKey)

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { width: cardWidth },
        pressed && feedback.pressed,
      ]}
      // The English term, in every UI language: U7 searches it in English.
      onPress={() => onSelect(topic.searchTerm)}
      accessibilityRole="button"
      accessibilityLabel={t("searchTopicAriaLabel", { topic: label })}
      {...{ "dd-action-name": "browse-topic" }}
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
          style={[
            Platform.OS === "ios"
              ? StyleSheet.absoluteFill
              : stretchedDecodeStyle(
                  cardWidth,
                  cardWidth / CARD_ASPECT_RATIO,
                  ANDROID_THUMBNAIL_SHRINK,
                ),
            styles.thumbnail,
          ]}
          contentFit="cover"
          blurRadius={
            Platform.OS === "ios" ? IOS_THUMBNAIL_BLUR_RADIUS : undefined
          }
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
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: CARD_ASPECT_RATIO,
    borderRadius: 20,
    // Also clips the stretched Android thumbnail, which is larger than the card.
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
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
})
