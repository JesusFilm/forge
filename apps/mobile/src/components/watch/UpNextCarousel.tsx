import { useCallback } from "react"
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
import { LinearGradient } from "expo-linear-gradient"
import { WatchProgressBar } from "./WatchProgressBar"
import { useRouter } from "expo-router"

import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  hexToRgba,
} from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { carousel, card, feedback, text, CARD_GAP } from "../../styles/shared"
import type { WatchSibling } from "../../lib/normalizeVideo"
import { encodeWatchSeed } from "../../lib/watchSeed"

// ── Props ──────────────────────────────────────────────────────────────────

export interface UpNextCarouselProps {
  siblings: WatchSibling[]
  currentSlug: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const CARD_WIDTH_RATIO = 0.45
const CARD_ASPECT_RATIO = 16 / 9

// ── Component ──────────────────────────────────────────────────────────────

export function UpNextCarousel({ siblings, currentSlug }: UpNextCarouselProps) {
  const router = useRouter()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()

  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO)
  const cardHeight = Math.round(cardWidth / CARD_ASPECT_RATIO)

  const renderItem = useCallback(
    ({ item }: { item: WatchSibling }) => {
      const isCurrent = item.slug === currentSlug
      const title = item.title ?? item.label ?? "Untitled"

      const handlePress = () => {
        if (!isCurrent) {
          // Siblings carry poster + title but no playbackId — a metadata-only
          // seed paints instantly; playback waits for the query to resolve.
          const seed = encodeWatchSeed({
            slug: item.slug,
            title: item.title ?? item.label ?? null,
            imageUrl: item.posterUrl ?? null,
            playbackId: null,
          })
          router.replace(`/watch/${encodeURIComponent(item.slug)}?seed=${seed}`)
        }
      }

      return (
        <Pressable
          style={({ pressed }) => [
            card.surface,
            { width: cardWidth, height: cardHeight },
            pressed && Platform.OS === "ios" && feedback.pressed,
          ]}
          android_ripple={{
            color: "rgba(255, 255, 255, 0.2)",
            foreground: true,
          }}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={
            isCurrent ? `Currently playing ${title}` : `Play ${title}`
          }
        >
          {item.posterUrl != null ? (
            <Image
              source={item.posterUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`upnext-${item.documentId}`}
              accessibilityLabel={title}
              priority="low"
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: SURFACE_COLOR },
              ]}
            />
          )}

          <LinearGradient
            colors={[hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.85)]}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <WatchProgressBar videoId={item.documentId} />

          {isCurrent && (
            <View style={styles.playingPill} pointerEvents="none">
              <Text style={[styles.playingPillText, typography.caption]}>
                Playing
              </Text>
            </View>
          )}

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
    },
    [currentSlug, cardWidth, cardHeight, typography, router],
  )

  if (siblings.length === 0) return null

  return (
    <View>
      <Text
        style={[text.sectionHeadingPadded, typography.titleLarge]}
        accessibilityRole="header"
      >
        Up Next
      </Text>
      <FlatList
        data={siblings}
        renderItem={renderItem}
        keyExtractor={(item) => item.documentId}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        accessibilityLabel={`${siblings.length} sibling videos`}
      />
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  playingPill: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  playingPillText: {
    fontWeight: "700",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  titleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  cardTitle: {
    fontWeight: "700",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
})
