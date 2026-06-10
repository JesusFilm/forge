import { memo, useCallback, useEffect, useRef } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"

import { ACCENT, TEXT_PRIMARY, hexToRgba } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import type { WatchHomeSlide } from "../../lib/watchHome/carouselSequence"

export type HomeChipRailProps = {
  /** The hero queue, mux inserts included — chips mirror it one-to-one. */
  slides: readonly WatchHomeSlide[]
  activeIndex: number
  /** Forward to HomeHeroPager's selectSlide (CHIP_TAPPED): swaps in place. */
  onChipPress: (index: number) => void
}

/**
 * Horizontal chip rail mirroring the hero pager queue. Renders as a SIBLING
 * below the pager: its own bounds own its touches (a horizontal list inside
 * its own frame), so no special gesture coordination with the pager or the
 * vertical feed is needed.
 *
 * Hidden for single-slide queues, matching the reducer's showsPagerChrome
 * rule (AE2).
 */
export const HomeChipRail = memo(function HomeChipRail({
  slides,
  activeIndex,
  onChipPress,
}: HomeChipRailProps) {
  const typography = useTypography()
  const listRef = useRef<FlatList<WatchHomeSlide>>(null)

  // Keep the active chip visible as the pager advances. Chips have intrinsic
  // (text-driven) widths, so scrollToIndex can fail for not-yet-measured
  // items — onScrollToIndexFailed below recovers via an offset estimate.
  useEffect(() => {
    if (slides.length <= 1) return
    try {
      listRef.current?.scrollToIndex({
        index: activeIndex,
        viewPosition: 0.5,
        animated: true,
      })
    } catch {
      // Out-of-range or unmeasured; the failure handler covers rendered lists.
    }
  }, [activeIndex, slides.length])

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: true,
      })
      setTimeout(() => {
        try {
          listRef.current?.scrollToIndex({
            index: info.index,
            viewPosition: 0.5,
            animated: true,
          })
        } catch {
          // Give up; the offset estimate above is close enough.
        }
      }, 120)
    },
    [],
  )

  const renderChip = useCallback(
    ({ item, index }: { item: WatchHomeSlide; index: number }) => {
      const selected = index === activeIndex
      return (
        <Pressable
          onPress={() => onChipPress(index)}
          style={({ pressed }) => [
            styles.chip,
            selected && styles.chipActive,
            pressed && styles.chipPressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={chipLabel(item)}
        >
          <Text
            style={[
              styles.chipText,
              selected && styles.chipTextActive,
              typography.bodySmall,
            ]}
            numberOfLines={1}
          >
            {chipLabel(item)}
          </Text>
        </Pressable>
      )
    },
    [activeIndex, onChipPress, typography],
  )

  const keyExtractor = useCallback((item: WatchHomeSlide) => item.id, [])

  if (slides.length <= 1) return null

  return (
    <View>
      <FlatList
        ref={listRef}
        data={slides}
        renderItem={renderChip}
        keyExtractor={keyExtractor}
        extraData={activeIndex}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={handleScrollToIndexFailed}
      />
    </View>
  )
})

/**
 * Mux insert chips show the insert's CONFIGURED title (not the time-of-day
 * overlay or date-prefixed display title), falling back to "Featured"; video
 * chips show the video title.
 */
function chipLabel(slide: WatchHomeSlide): string {
  if (slide.kind === "mux") {
    const title = slide.insert.title.trim()
    return title !== "" ? title : "Featured"
  }
  return slide.title
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    minHeight: 44, // touch-target floor
    maxWidth: 220,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  chipActive: {
    borderColor: ACCENT,
    backgroundColor: hexToRgba(ACCENT, 0.18),
  },
  chipPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  chipText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "500",
  },
  chipTextActive: {
    fontWeight: "700",
  },
})
