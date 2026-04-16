import { useEffect, useRef } from "react"
import { Animated, StyleSheet, View } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"

const CARD_COUNT = 6

export function SearchResultSkeleton() {
  const shimmer = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [shimmer])

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
