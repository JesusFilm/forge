import { useEffect, useRef, useState } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"
import { useSegments } from "expo-router"

import {
  TAB_BAR_LENS_BORDER,
  TAB_BAR_LENS_DURATION_MS,
  TAB_BAR_LENS_FILL,
  TAB_BAR_LENS_HEIGHT,
  TAB_BAR_LENS_INSET,
  TAB_BAR_LENS_RADIUS,
  TAB_ROUTE_NAMES,
  tabIndexForSegments,
} from "../../lib/tabBar"

/**
 * The lit capsule that slides between tabs, drawn over the material and under
 * the icons. The bar lays its items out as equal flex cells with no horizontal
 * padding, so a segment is exactly the measured width divided by the tab count.
 */
export function TabBarLens() {
  const routeIndex = tabIndexForSegments(useSegments())
  // A pushed route (a video over the tabs) reports null. Hold the cell we were
  // on rather than sliding somewhere arbitrary while the bar is still visible.
  const heldIndex = useRef(0)
  if (routeIndex !== null) heldIndex.current = routeIndex
  const index = heldIndex.current
  const [width, setWidth] = useState(0)
  const translateX = useRef(new Animated.Value(0)).current
  // The first position is a jump, not a slide: a cold launch onto any tab but
  // the first would otherwise animate in from Home.
  const placed = useRef(false)

  const segment = width / TAB_ROUTE_NAMES.length

  useEffect(() => {
    if (segment <= 0) return
    const to = index * segment
    if (!placed.current) {
      placed.current = true
      translateX.setValue(to)
      return
    }
    const animation = Animated.timing(translateX, {
      toValue: to,
      duration: TAB_BAR_LENS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [index, segment, translateX])

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      pointerEvents="none"
    >
      {segment > 0 && (
        <Animated.View
          style={[
            styles.lens,
            {
              width: segment - TAB_BAR_LENS_INSET * 2,
              transform: [{ translateX }],
            },
          ]}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  lens: {
    position: "absolute",
    top: TAB_BAR_LENS_INSET,
    left: TAB_BAR_LENS_INSET,
    height: TAB_BAR_LENS_HEIGHT,
    borderRadius: TAB_BAR_LENS_RADIUS,
    backgroundColor: TAB_BAR_LENS_FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TAB_BAR_LENS_BORDER,
  },
})
