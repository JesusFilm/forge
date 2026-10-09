import { useEffect, useRef, useState } from "react"
import {
  Animated,
  AppState,
  Easing,
  Image,
  StyleSheet,
  View,
} from "react-native"
import type { LoadingAnimationId } from "../lib/logoAnimations"
import { scale } from "../lib/scale"
import { useReduceMotion } from "../hooks/useReduceMotion"
import { LogoAnimation } from "./LogoAnimation"

export function LoadingAnimation({
  id,
  active = true,
  size = 600,
}: {
  id: LoadingAnimationId
  active?: boolean
  size?: number
}) {
  return id === "dots" ? (
    <DotLoading active={active} size={size} />
  ) : (
    <LogoAnimation id={id} active={active} size={size} />
  )
}

function DotLoading({ active, size }: { active: boolean; size: number }) {
  const phase = useRef(new Animated.Value(0)).current
  const reduceMotion = useReduceMotion()
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background",
  )
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state !== "background"),
    )
    return () => subscription.remove()
  }, [])
  const animate = active && foreground && !reduceMotion
  useEffect(() => {
    if (!animate) return
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
  }, [animate, phase])
  return (
    <View style={styles.root}>
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require("../../assets/icon.png")}
        style={{
          width: scale((size * 8) / 15),
          height: scale((size * 8) / 15),
        }}
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
                opacity: animate
                  ? phase.interpolate({
                      inputRange: [
                        0,
                        0.2 + index * 0.15,
                        0.5 + index * 0.15,
                        1,
                      ],
                      outputRange: [0.3, 1, 0.3, 0.3],
                    })
                  : 1,
              },
            ]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  dots: { flexDirection: "row", gap: scale(16), marginTop: scale(24) },
  dot: {
    width: scale(14),
    height: scale(14),
    borderRadius: scale(7),
    backgroundColor: "#f12c3e",
  },
})
