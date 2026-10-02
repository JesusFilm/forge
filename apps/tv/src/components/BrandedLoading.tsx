import { useEffect, useRef } from "react"
import { Animated, Easing, Image, StyleSheet, View } from "react-native"

import { useReduceMotion } from "../hooks/useReduceMotion"
import { scale } from "../lib/scale"

export function BrandedLoading({ label = "Loading Home" }: { label?: string }) {
  const phase = useRef(new Animated.Value(0)).current
  const reduceMotion = useReduceMotion()

  useEffect(() => {
    if (reduceMotion) return
    const animation = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    )
    animation.start()
    return () => {
      animation.stop()
      phase.setValue(0)
    }
  }, [phase, reduceMotion])

  return (
    <View
      style={styles.root}
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require("../../assets/icon.png")}
        style={styles.logo}
        resizeMode="contain"
        accessible={false}
      />
      <View style={styles.dots}>
        {[0, 1, 2].map((index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                opacity: reduceMotion
                  ? 1
                  : phase.interpolate({
                      inputRange: [
                        0,
                        0.2 + index * 0.15,
                        0.5 + index * 0.15,
                        1,
                      ],
                      outputRange: [0.3, 1, 0.3, 0.3],
                    }),
              },
            ]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#161311",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: scale(320), height: scale(320) },
  dots: { flexDirection: "row", gap: scale(16), marginTop: scale(24) },
  dot: {
    width: scale(14),
    height: scale(14),
    borderRadius: scale(7),
    backgroundColor: "#f12c3e",
  },
})
