import { Animated, StyleSheet, View } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"
import {
  SEARCH_CARD_GAP_X,
  SEARCH_CARD_GAP_Y,
  SEARCH_CARD_RADIUS,
  SEARCH_CARD_TEXT_HEIGHT,
  SEARCH_THUMB_ASPECT,
} from "./searchCardLayout"

const CARD_COUNT = 6

export function SearchResultSkeleton() {
  const shimmer = useShimmerOpacity()

  return (
    <View
      style={styles.grid}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {Array.from({ length: CARD_COUNT }, (_, i) => (
        <View key={i} style={styles.cardWrapper}>
          <Animated.View style={{ opacity: shimmer }}>
            <View style={styles.thumb} />
            <View style={styles.textBlock}>
              <View style={styles.bar} />
            </View>
          </Animated.View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  cardWrapper: {
    width: "50%",
    paddingHorizontal: SEARCH_CARD_GAP_X,
    paddingVertical: SEARCH_CARD_GAP_Y,
  },
  // Mirrors SearchResultCard's box exactly, so the grid does not
  // reflow when real results replace the shimmer.
  thumb: {
    aspectRatio: SEARCH_THUMB_ASPECT,
    width: "100%",
    borderRadius: SEARCH_CARD_RADIUS,
    backgroundColor: SURFACE_COLOR,
  },
  textBlock: {
    height: SEARCH_CARD_TEXT_HEIGHT,
    paddingTop: 8,
  },
  bar: {
    width: "70%",
    height: 10,
    borderRadius: 5,
    backgroundColor: SURFACE_COLOR,
  },
})
