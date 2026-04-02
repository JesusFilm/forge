import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

type MediaItem = {
  id: string
  titleOverride?: string | null
  subtitleOverride?: string | null
  labelOverride?: string | null
  collectionSize?: number | null
  imageUrl?: string | null
  linkToSectionKey?: string | null
  video?: {
    documentId?: string
    title?: string
    slug?: string
    imageAlt?: string
    images?: {
      url?: string
      mobileCinematicHigh?: string
      videoStill?: string
    }
  } | null
}

export interface MediaCollectionRendererProps {
  section: NormalizedBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const HORIZONTAL_PADDING = 16
const CARD_GAP = 12
const CARD_WIDTH = 140
const CARD_ASPECT = 3 / 4
const GRADIENT_COLORS: [string, string] = [
  hexToRgba("#000000", 0),
  hexToRgba("#000000", 0.85),
]

// ── Component ───────────────────────────────────────────────────────────────

export function MediaCollectionRenderer({
  section,
}: MediaCollectionRendererProps) {
  const typography = useTypography()

  const mcTitle = section.mcTitle as string | null
  const mcSubtitle = section.mcSubtitle as string | null
  const categoryLabel = section.categoryLabel as string | null
  const items = (section.items as MediaItem[] | undefined) ?? []

  if (items.length === 0) return null

  return (
    <View style={styles.container}>
      {categoryLabel != null && (
        <Text style={[styles.categoryLabel, typography.caption]}>
          {categoryLabel.toUpperCase()}
        </Text>
      )}
      {mcTitle != null && (
        <Text
          style={[styles.title, typography.heading]}
          accessibilityRole="header"
        >
          {mcTitle}
        </Text>
      )}
      {mcSubtitle != null && (
        <Text style={[styles.subtitle, typography.bodySmall]}>
          {mcSubtitle}
        </Text>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        accessibilityRole="adjustable"
        accessibilityLabel={`${items.length} media items`}
      >
        {items.map((item, index) => {
          const thumbnailUrl = resolveImageUrl(
            item.imageUrl ??
              item.video?.images?.mobileCinematicHigh ??
              item.video?.images?.videoStill ??
              item.video?.images?.url ??
              null,
          )
          const title = item.titleOverride ?? item.video?.title ?? "Untitled"
          const label = item.labelOverride ?? categoryLabel
          const alt = item.video?.imageAlt ?? title

          return (
            <Pressable
              key={`mediaCollection-${item.id}-${index}`}
              style={({ pressed }) => [
                styles.card,
                pressed && Platform.OS === "ios" && styles.cardPressed,
              ]}
              android_ripple={{
                color: "rgba(255, 255, 255, 0.2)",
                foreground: true,
              }}
              accessibilityLabel={`${label ?? ""} ${title}`.trim()}
              accessibilityHint="Opens this collection"
            >
              <View style={styles.cardInner}>
                {thumbnailUrl != null && (
                  <Image
                    source={thumbnailUrl}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    recyclingKey={`mc-${item.id}-${index}`}
                    accessibilityLabel={alt}
                    priority="low"
                  />
                )}
                <LinearGradient
                  colors={GRADIENT_COLORS}
                  locations={[0.4, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                {item.collectionSize != null && (
                  <View style={styles.badge}>
                    <Text style={[styles.badgeText, typography.caption]}>
                      {item.collectionSize}
                    </Text>
                  </View>
                )}
                <View style={styles.textContent}>
                  {label != null && (
                    <Text
                      style={[styles.label, typography.caption]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                  )}
                  <Text
                    style={[styles.cardTitle, typography.bodySmall]}
                    numberOfLines={2}
                  >
                    {title}
                  </Text>
                </View>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    paddingVertical: 8,
  },
  categoryLabel: {
    fontWeight: "600",
    color: "#a8a29e",
    fontFamily: "System",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  title: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  subtitle: {
    fontWeight: "400",
    color: "#a8a29e",
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  scrollContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#292524",
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardInner: {
    width: "100%",
    aspectRatio: CARD_ASPECT,
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    color: "#ffffff",
    fontFamily: "System",
    fontWeight: "600",
  },
  textContent: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
  },
  label: {
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: "System",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  cardTitle: {
    color: "#ffffff",
    fontFamily: "System",
    fontWeight: "700",
  },
})
