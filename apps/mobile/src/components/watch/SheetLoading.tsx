import { Animated, StyleSheet, View } from "react-native"

import { SURFACE_COLOR } from "../../lib/color"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"

/**
 * Shimmering placeholder rows for a formSheet whose data is still arriving
 * (e.g. variants/subtitles not yet enriched). Signals "loading", not "empty".
 */
export function SheetLoading({ rows = 4 }: { rows?: number }) {
  const opacity = useShimmerOpacity()
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[styles.row, { opacity }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 14,
  },
  row: {
    height: 44,
    borderRadius: 12,
    backgroundColor: SURFACE_COLOR,
  },
})
