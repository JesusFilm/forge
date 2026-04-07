import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import Ionicons from "@expo/vector-icons/Ionicons"

import {
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"
import type { VideoRef } from "../../lib/types"

// ── Types ───────────────────────────────────────────────────────────────────

type VideoCarouselItem = {
  id: string
  streamingUrl?: string | null
  imageUrl?: string | null
  titleOverride?: string | null
  backgroundColor?: string | null
  video?: VideoRef | null
}

export interface VideoCarouselRendererProps {
  section: NormalizedBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const CARD_GAP = 12
const HORIZONTAL_PADDING = 16
const CARD_WIDTH_RATIO = 0.6
const CARD_ASPECT_RATIO = 9 / 16

// ── Component ───────────────────────────────────────────────────────────────

export function VideoCarouselRenderer({ section }: VideoCarouselRendererProps) {
  const router = useRouter()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const vcTitle = section.vcTitle as string | null
  const vcSubtitle = section.vcSubtitle as string | null
  const items = (section.items as VideoCarouselItem[] | undefined) ?? []

  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO)
  const cardHeight = Math.round(cardWidth / CARD_ASPECT_RATIO)

  if (items.length === 0) return null

  const renderItem = ({
    item,
    index,
  }: {
    item: VideoCarouselItem
    index: number
  }) => {
    const thumbnailUrl = resolveImageUrl(
      item.imageUrl ??
        item.video?.images?.mobileCinematicHigh ??
        item.video?.images?.videoStill ??
        item.video?.images?.url ??
        null,
    )
    const title = item.titleOverride ?? item.video?.title ?? "Untitled"
    const videoSlug = item.video?.slug

    const handlePress = () => {
      if (videoSlug) {
        router.push(`/video/${encodeURIComponent(videoSlug)}`)
      }
    }

    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          { width: cardWidth, height: cardHeight },
          pressed && Platform.OS === "ios" && styles.cardPressed,
        ]}
        android_ripple={{ color: "rgba(255, 255, 255, 0.2)", foreground: true }}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${title}`}
      >
        {thumbnailUrl != null ? (
          <Image
            source={thumbnailUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={`vc-${item.id}-${index}`}
            accessibilityLabel={item.video?.imageAlt ?? title}
            priority="low"
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: item.backgroundColor ?? SURFACE_COLOR,
              },
            ]}
          />
        )}

        {/* Play icon overlay */}
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playCircle}>
            <Ionicons
              name="play"
              size={18}
              color={TEXT_ON_OVERLAY}
              style={{ marginLeft: 3 }}
            />
          </View>
        </View>

        {/* Title at bottom */}
        <View style={styles.titleOverlay} pointerEvents="none">
          <Text
            style={[styles.cardTitle, typography.bodySmall]}
            numberOfLines={2}
          >
            {title}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    <View style={styles.container}>
      {vcTitle != null && (
        <Text
          style={[styles.sectionTitle, typography.heading]}
          accessibilityRole="header"
        >
          {vcTitle}
        </Text>
      )}
      {vcSubtitle != null && (
        <Text style={[styles.sectionSubtitle, typography.bodySmall]}>
          {vcSubtitle}
        </Text>
      )}
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item, index) => `videoCarousel-${item.id}-${index}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        accessibilityLabel={`${items.length} video items`}
      />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  sectionTitle: {
    fontWeight: "700",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontWeight: "400",
    color: TEXT_SECONDARY,
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  listContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: SURFACE_COLOR,
  },
  cardPressed: {
    opacity: 0.85,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `rgba(0, 0, 0, 0.5)`,
    justifyContent: "center",
    alignItems: "center",
  },
  titleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  cardTitle: {
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
})
