import { useMemo } from "react"
import { StyleSheet, View } from "react-native"

import { TEXT_ON_OVERLAY } from "../../lib/color"

export type HomePagerDotsProps = {
  count: number
  activeIndex: number
}

/**
 * Page indicator for the Home hero pager: dots, active one elongated.
 * Returns null for single-slide queues (mirrors showsPagerChrome — AE2);
 * the pager also gates on the selector so both stay in agreement.
 */
export function HomePagerDots({ count, activeIndex }: HomePagerDotsProps) {
  const indexes = useMemo(
    () => Array.from({ length: count }, (_, i) => i),
    [count],
  )

  if (count <= 1) return null

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`Slide ${activeIndex + 1} of ${count}`}
    >
      {indexes.map((i) => (
        <View
          key={i}
          style={[styles.dot, i === activeIndex && styles.dotActive]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  dotActive: {
    width: 18,
    backgroundColor: TEXT_ON_OVERLAY,
  },
})
