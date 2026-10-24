// Focus-aware Ionicons glyph for watch-detail surfaces. Ionicons colour is a
// prop, not animatable, so the rest→focus flip cross-fades two stacked copies
// (opacity is animatable), driven by the focus module's 0→1 progress.

import { Animated, StyleSheet, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { WATCH_THEME } from "./watchDetailTheme"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

export function AnimatedFocusIcon({
  name,
  progress,
  size,
  restColor = WATCH_THEME.text,
  focusColor = WATCH_THEME.focusInk,
}: {
  name: IconName
  progress: Animated.Value
  size: number
  /** Glyph colour at rest (focus progress 0). Defaults to white. */
  restColor?: string
  /** Glyph colour when focused (focus progress 1). Defaults to near-black ink. */
  focusColor?: string
}) {
  return (
    <View style={[styles.iconBox, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.iconLayer,
          {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          },
        ]}
      >
        <Ionicons name={name} size={size} color={restColor} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, { opacity: progress }]}>
        <Ionicons name={name} size={size} color={focusColor} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  iconBox: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
})
