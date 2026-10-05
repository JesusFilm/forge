import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Image } from "expo-image"

import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { useLocaleEpoch, useT } from "../../i18n/useT"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { WatchHomeSlide } from "../../lib/watchHome/carouselSequence"
import { HORIZONTAL_PADDING, feedback } from "../../styles/shared"

export type HomeHeroSelectorRailProps = {
  /** The hero queue, mux inserts included — cards mirror it one-to-one. */
  slides: readonly WatchHomeSlide[]
  activeIndex: number
  /** Forward to HomeHeroPager's selectSlide (CHIP_TAPPED): swaps in place. */
  onSelectSlide: (index: number) => void
}

/**
 * Mini video-card rail mirroring the hero pager queue (thumb + title, accent ring on the active
 * slide). Renders as a sibling below the pager so it owns its own touches. Half the shelf-card size,
 * title below; hidden for 1 slide (reducer's showsPagerChrome rule, AE2).
 */
export const HomeHeroSelectorRail = memo(function HomeHeroSelectorRail({
  slides,
  activeIndex,
  onSelectSlide,
}: HomeHeroSelectorRailProps) {
  const typography = useTypography()
  const t = useT("Home")
  const epoch = useLocaleEpoch()
  const { width: screenWidth } = useWindowDimensions()
  const listRef = useRef<FlatList<WatchHomeSlide>>(null)

  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO)
  // Reserve two caption lines so 1-line and 2-line titles render equal-height
  // cards (a horizontal FlatList stretches rows to the tallest item).
  const titleMinHeight = typography.caption.lineHeight * 2

  // Keep the active card centered as the pager advances. Fixed card widths
  // make getItemLayout exact, so scrollToIndex never needs a failure handler.
  useEffect(() => {
    if (slides.length <= 1) return
    listRef.current?.scrollToIndex({
      index: Math.min(activeIndex, slides.length - 1),
      viewPosition: 0.5,
      animated: true,
    })
  }, [activeIndex, slides.length])

  const getItemLayout = useCallback(
    (_data: unknown, index: number) => ({
      length: cardWidth,
      offset: HORIZONTAL_PADDING + (cardWidth + CARD_GAP) * index,
      index,
    }),
    [cardWidth],
  )

  const renderCard = useCallback(
    ({ item, index }: { item: WatchHomeSlide; index: number }) => {
      const selected = index === activeIndex
      const thumbnailUrl = resolveImageUrl(item.thumbnailUrl ?? item.posterUrl)
      const label = cardLabel(item, t("featuredFallbackTitle"))
      return (
        <Pressable
          onPress={() => onSelectSlide(index)}
          style={({ pressed }) => [
            { width: cardWidth },
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={label}
          accessibilityHint={
            selected ? undefined : t("featuredSelectorCardAriaHint")
          }
          {...{ "dd-action-name": "hero-selector-card" }}
        >
          <View
            style={[styles.thumbFrame, selected && styles.thumbFrameActive]}
          >
            <View style={styles.thumb}>
              {thumbnailUrl != null && (
                <Image
                  source={thumbnailUrl}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  recyclingKey={item.id}
                  accessibilityLabel={item.imageAlt}
                  priority="low"
                />
              )}
            </View>
          </View>
          <Text
            style={[
              styles.title,
              selected && styles.titleActive,
              typography.caption,
              { minHeight: titleMinHeight },
            ]}
            numberOfLines={2}
          >
            {label}
          </Text>
        </Pressable>
      )
    },
    [activeIndex, onSelectSlide, cardWidth, titleMinHeight, typography, t],
  )

  const keyExtractor = useCallback((item: WatchHomeSlide) => item.id, [])
  // Recycled cards take the new language on a catalog change (KTD5).
  const extraData = useMemo(
    () => ({ activeIndex, epoch }),
    [activeIndex, epoch],
  )

  if (slides.length <= 1) return null

  return (
    <View>
      <FlatList
        ref={listRef}
        data={slides}
        renderItem={renderCard}
        keyExtractor={keyExtractor}
        extraData={extraData}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        getItemLayout={getItemLayout}
        accessibilityLabel={t("featuredSelectorAriaLabel")}
      />
    </View>
  )
})

/** Selector cards at 0.3 screen width — half the content shelves' landscape 0.6. */
const CARD_WIDTH_RATIO = 0.3

/** Tighter than the shelves' 12 CARD_GAP so the rail reads as one control. */
const CARD_GAP = 10

/**
 * Mux insert cards show the insert's CONFIGURED title (not the overlay/display
 * title), falling back to `fallback`; video cards show the video title.
 */
function cardLabel(slide: WatchHomeSlide, fallback: string): string {
  if (slide.kind === "mux") {
    const title = slide.insert.title.trim()
    return title !== "" ? title : fallback
  }
  return slide.title
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
  // Ring sits OUTSIDE the thumbnail (border + breathing-room padding) so the
  // active accent reads as a selection marker, not part of the artwork.
  thumbFrame: {
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.14)",
    padding: 2,
  },
  thumbFrameActive: {
    borderColor: ACCENT,
  },
  thumb: {
    aspectRatio: 16 / 9,
    borderRadius: 7,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  title: {
    marginTop: 6,
    paddingHorizontal: 2,
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "500",
  },
  titleActive: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
  },
})
