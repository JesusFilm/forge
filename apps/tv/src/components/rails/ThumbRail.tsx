// The WATCH-theme horizontal rail scaffold shared by Episodes and Up Next:
// SECTION_HEADING + count, TVFocusGuideView, virtualized FlatList with fixed
// ThumbCard dims (getItemLayout — no measuring pass). Was two inline copies;
// Up Next gained virtualization by adoption.

import { useCallback, type ReactElement } from "react"
import { FlatList, StyleSheet, Text, View } from "react-native"
import type { ListRenderItemInfo } from "react-native"

import { scale } from "../../lib/scale"
import { SECTION_HEADING } from "../sections/sectionHeading"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { THUMB_CARD_WIDTH } from "./ThumbCard"

const ITEM_GAP = scale(30)

// Fixed card dims → no measuring pass. The last item has no trailing gap, so
// its length is overstated by ITEM_GAP — harmless for virtualization and
// scrollToIndex. Module-scope: pure function of module constants.
const getItemLayout = (_: unknown, index: number) => ({
  length: THUMB_CARD_WIDTH + ITEM_GAP,
  offset: (THUMB_CARD_WIDTH + ITEM_GAP) * index,
  index,
})

type ThumbRailProps<T> = {
  heading: string
  countLabel: string
  data: T[]
  keyExtractor: (item: T, index: number) => string
  /** Renders one ThumbCard; re-emit the ITEM from onPress, never re-index into
   *  `data` from an async callback (the array can shrink under it). */
  renderCard: (item: T, index: number) => ReactElement
}

export function ThumbRail<T>({
  heading,
  countLabel,
  data,
  keyExtractor,
  renderCard,
}: ThumbRailProps<T>) {
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<T>) => (
      <View
        style={[styles.itemWrapper, index < data.length - 1 && styles.itemGap]}
      >
        {renderCard(item, index)}
      </View>
    ),
    [data.length, renderCard],
  )

  if (data.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.headTitle} accessibilityRole="header">
          {heading}
        </Text>
        <Text style={styles.headCount}>{countLabel}</Text>
      </View>

      <TVFocusGuideView autoFocus>
        <FlatList
          data={data}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          onScrollToIndexFailed={() => {}}
          getItemLayout={getItemLayout}
          renderItem={renderItem}
        />
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(20),
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: scale(18),
    marginBottom: scale(30),
    paddingHorizontal: scale(80),
  },
  headTitle: SECTION_HEADING,
  headCount: {
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "500",
    color: WATCH_THEME.text50,
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  // Vertical room so the lift + focus ring + icon overlay never clip neighbours.
  itemWrapper: {
    paddingVertical: scale(40),
  },
  itemGap: {
    marginRight: ITEM_GAP,
  },
})
