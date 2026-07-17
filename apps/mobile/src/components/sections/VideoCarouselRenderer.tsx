import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import { SURFACE_COLOR, TEXT_ON_OVERLAY } from "../../lib/color"
import { resolveThumbnailUrl } from "../../lib/resolveThumbnailUrl"
import { useTypography } from "../../hooks/useTypography"
import {
  carousel,
  card,
  layout,
  text,
  CARD_GAP,
  HORIZONTAL_PADDING,
} from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { useExperienceContext } from "../../contexts/ExperienceProvider"
import { PressableCard } from "../ui/PressableCard"

// ── Types ───────────────────────────────────────────────────────────────────

type CarouselItem = {
  videoId?: string | null
  streamingUrl?: string | null
  imageUrl?: string | null
  titleOverride?: string | null
  backgroundColor?: string | null
}

export interface VideoCarouselRendererProps {
  section: AdminBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const CARD_WIDTH_RATIO = 0.6
const CARD_ASPECT_RATIO = 9 / 16

// ── Component ───────────────────────────────────────────────────────────────

export function VideoCarouselRenderer({ section }: VideoCarouselRendererProps) {
  const router = useRouter()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()
  const { getVideoThumbnail } = useExperienceContext()

  const s = section as Record<string, unknown>
  const vcTitle = s.title as string | null
  const vcSubtitle = s.subtitle as string | null
  const items = (s.items as CarouselItem[] | undefined) ?? []

  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO)
  const cardHeight = Math.round(cardWidth / CARD_ASPECT_RATIO)

  if (items.length === 0) return null

  const renderItem = ({
    item,
    index,
  }: {
    item: CarouselItem
    index: number
  }) => {
    const resolvedThumb = item.videoId ? getVideoThumbnail(item.videoId) : null
    const thumbnailUrl = resolveThumbnailUrl(item.imageUrl ?? resolvedThumb)
    const title = item.titleOverride ?? "Untitled"
    const carouselSectionKey = s.sectionKey as string | undefined

    const handlePress = () => {
      if (carouselSectionKey) {
        router.push(
          `/collection/${encodeURIComponent(carouselSectionKey)}?index=${index}`,
        )
      }
    }

    return (
      <PressableCard
        onPress={handlePress}
        accessibilityLabel={`Play ${title}`}
        style={[card.surface, { width: cardWidth, height: cardHeight }]}
        background={
          thumbnailUrl != null ? (
            <Image
              source={thumbnailUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`vc-${index}`}
              accessibilityLabel={title}
              priority="low"
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: item.backgroundColor ?? SURFACE_COLOR },
              ]}
            />
          )
        }
        playOverlay="small"
      >
        <View style={styles.titleOverlay} pointerEvents="none">
          <Text style={[styles.cardTitle, typography.bodySmall]}>{title}</Text>
        </View>
      </PressableCard>
    )
  }

  return (
    <View style={layout.sectionOuter}>
      {vcSubtitle != null && (
        <Text
          style={[
            text.sectionSubtitle,
            styles.localSubtitle,
            typography.bodySmall,
          ]}
        >
          {vcSubtitle}
        </Text>
      )}
      {vcTitle != null && (
        <Text
          style={[text.sectionHeadingPadded, typography.heading]}
          accessibilityRole="header"
        >
          {vcTitle}
        </Text>
      )}
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(_item, index) => `vc-${index}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
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
  localSubtitle: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 2,
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
