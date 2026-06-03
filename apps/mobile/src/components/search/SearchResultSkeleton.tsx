import { Animated, StyleSheet, View } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"

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
          <Animated.View style={[styles.card, { opacity: shimmer }]} />
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
    padding: 6,
  },
  card: {
    aspectRatio: 4 / 3,
    borderRadius: 16,
    backgroundColor: SURFACE_COLOR,
  },
})
