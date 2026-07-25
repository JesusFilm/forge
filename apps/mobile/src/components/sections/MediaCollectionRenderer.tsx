import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"
import { useRouter } from "expo-router"

import { TEXT_ON_OVERLAY } from "../../lib/color"
import { resolveMediaCollectionThumbnailOrientation } from "../../lib/mediaCollectionThumbnailOrientation"
import { resolveThumbnailUrl } from "../../lib/resolveThumbnailUrl"
import { useTypography } from "../../hooks/useTypography"
import {
  card,
  carousel,
  layout,
  text,
  CARD_GAP,
  HORIZONTAL_PADDING,
} from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { useExperienceContext } from "../../contexts/ExperienceProvider"
import { PressableCard } from "../ui/PressableCard"

// ── Types ───────────────────────────────────────────────────────────────────

type MediaItem = {
  videoId?: string | null
  titleOverride?: string | null
  subtitleOverride?: string | null
  labelOverride?: string | null
  collectionSize?: number | null
  imageUrl?: string | null
  linkToSectionKey?: string | null
}

export interface MediaCollectionRendererProps {
  section: AdminBlock
}

// ── Constants ───────────────────────────────────────────────────────────────

const VERTICAL_CARD_WIDTH_RATIO = 0.37
const HORIZONTAL_CARD_WIDTH_RATIO = 0.72
const VERTICAL_CARD_ASPECT = 3 / 4
const HORIZONTAL_CARD_ASPECT = 16 / 9

// ── Component ───────────────────────────────────────────────────────────────

export function MediaCollectionRenderer({
  section,
}: MediaCollectionRendererProps) {
  const router = useRouter()
  const typography = useTypography()
  const { width: screenWidth } = useWindowDimensions()
  const { getVideoThumbnail, getVideoTitle } = useExperienceContext()

  const s = section as Record<string, unknown>
  const mcTitle = s.title as string | null
  const mcSubtitle = s.subtitle as string | null
  const categoryLabel = s.categoryLabel as string | null
  const items = (s.items as MediaItem[] | undefined) ?? []
  const thumbnailOrientation = resolveMediaCollectionThumbnailOrientation(
    s.thumbnailOrientation,
    "vertical",
  )

  const cardWidth = Math.round(
    screenWidth *
      (thumbnailOrientation === "horizontal"
        ? HORIZONTAL_CARD_WIDTH_RATIO
        : VERTICAL_CARD_WIDTH_RATIO),
  )
  const cardAspect =
    thumbnailOrientation === "horizontal"
      ? HORIZONTAL_CARD_ASPECT
      : VERTICAL_CARD_ASPECT

  if (items.length === 0) return null

  const renderItem = ({ item, index }: { item: MediaItem; index: number }) => {
    const resolvedThumb = item.videoId ? getVideoThumbnail(item.videoId) : null
    const thumbnailUrl =
      resolveThumbnailUrl(item.imageUrl) ?? resolveThumbnailUrl(resolvedThumb)
    // Match TV: flat items carry no titleOverride, so fall back to the linked
    // video's localized title before the generic label. `||` so an empty
    // override (admin clears to "") falls through instead of blanking the card.
    const resolvedTitle = item.videoId ? getVideoTitle(item.videoId) : null
    const title =
      item.titleOverride || resolvedTitle || item.labelOverride || ""
    const label = item.labelOverride ?? categoryLabel

    const handlePress = () => {
      const key = item.linkToSectionKey
      if (key) {
        router.push(`/video/${encodeURIComponent(key)}`)
      }
    }

    return (
      <PressableCard
        onPress={handlePress}
        accessibilityLabel={`${label ?? ""} ${title}`.trim()}
        accessibilityHint="Opens this video"
        style={[card.surface, { width: cardWidth }]}
        surfaceStyle={[styles.cardInner, { aspectRatio: cardAspect }]}
        background={
          thumbnailUrl != null ? (
            <Image
              source={thumbnailUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`mc-${index}`}
              accessibilityLabel={title}
              priority="low"
            />
          ) : undefined
        }
        scrim="standard"
      >
        {item.collectionSize != null && (
          <View style={card.badge}>
            <Text style={[card.badgeText, typography.caption]}>
              {item.collectionSize}
            </Text>
          </View>
        )}
        <View style={styles.textContent}>
          {label != null && (
            <Text style={[styles.label, typography.caption]} numberOfLines={1}>
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
      </PressableCard>
    )
  }

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      {categoryLabel != null && (
        <Text style={[text.eyebrow, styles.categoryLabel, typography.caption]}>
          {categoryLabel.toUpperCase()}
        </Text>
      )}
      {mcTitle != null && (
        <Text
          style={[
            text.sectionHeadingPadded,
            styles.localTitle,
            typography.heading,
          ]}
          accessibilityRole="header"
        >
          {mcTitle}
        </Text>
      )}
      {mcSubtitle != null && (
        <Text
          style={[
            text.sectionSubtitle,
            styles.localSubtitle,
            typography.bodySmall,
          ]}
        >
          {mcSubtitle}
        </Text>
      )}

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(_item, index) => `mc-${index}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        accessibilityLabel={`${items.length} media items`}
      />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localContainer: {
    paddingVertical: 8,
  },
  categoryLabel: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 4,
  },
  localTitle: {
    marginBottom: 20,
  },
  localSubtitle: {
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 20,
  },
  cardInner: {
    width: "100%",
  },
  textContent: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
  },
  label: {
    color: "rgba(255, 255, 255, 0.90)",
    fontFamily: "System",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  cardTitle: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
  },
})
