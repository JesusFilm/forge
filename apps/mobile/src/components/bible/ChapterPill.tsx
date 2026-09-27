import { useEffect, useRef, useState, type ReactNode } from "react"
import { Animated, Easing, StyleSheet } from "react-native"

import {
  READER_GLASS_SIZE,
  READER_TOUCH_TARGET,
} from "../../lib/bible/reader/chrome"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { ReaderGlassButton } from "./ReaderGlassButton"

/** R39: the pill's short scale and highlight at a chapter change. */
export const CHAPTER_PULSE_MS = 420

/** Reduce Motion: the highlight snaps on, holds this long, and snaps off. */
export const CHAPTER_FLASH_MS = 700

const PULSE_SCALE = 1.08
const HIGHLIGHT_OPACITY = 0.3

export type ChapterPillProps = {
  tokens: ReaderTokens
  accessibilityLabel: string
  onPress: () => void
  disabled: boolean
  /** A new value plays the animation; the first value plays nothing. */
  pulse: number
  reduceMotion: boolean
  children: ReactNode
}

// The pill (R8, R39). The pill is a GlassView, which draws nothing under an
// animated opacity, so the animation scales it and fades a separate layer.
export function ChapterPill({
  tokens,
  accessibilityLabel,
  onPress,
  disabled,
  pulse,
  reduceMotion,
  children,
}: ChapterPillProps) {
  const [progress] = useState(() => new Animated.Value(0))
  const [flash] = useState(() => new Animated.Value(0))
  const seenPulse = useRef(pulse)

  useEffect(() => {
    if (seenPulse.current === pulse) return
    seenPulse.current = pulse
    let animation: Animated.CompositeAnimation
    if (reduceMotion) {
      flash.setValue(1)
      animation = Animated.timing(flash, {
        toValue: 0,
        duration: 0,
        delay: CHAPTER_FLASH_MS,
        useNativeDriver: true,
      })
    } else {
      progress.setValue(0)
      animation = Animated.timing(progress, {
        toValue: 1,
        duration: CHAPTER_PULSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    }
    animation.start(({ finished }) => {
      // A stopped animation must not leave the pill large or lit.
      if (finished) return
      progress.setValue(0)
      flash.setValue(0)
    })
    return () => animation.stop()
  }, [pulse, reduceMotion, progress, flash])

  const scale = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [1, PULSE_SCALE, 1],
  })
  const highlight = reduceMotion
    ? flash.interpolate({
        inputRange: [0, 1],
        outputRange: [0, HIGHLIGHT_OPACITY],
      })
    : progress.interpolate({
        inputRange: [0, 0.3, 1],
        outputRange: [0, HIGHLIGHT_OPACITY, 0],
      })

  return (
    <Animated.View
      testID="bible-chapter-pill"
      style={[styles.wrap, !reduceMotion && { transform: [{ scale }] }]}
    >
      <ReaderGlassButton
        tokens={tokens}
        shape="pill"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        disabled={disabled}
        style={styles.button}
      >
        {children}
      </ReaderGlassButton>
      <Animated.View
        testID="bible-chapter-pill-highlight"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.highlight,
          { backgroundColor: tokens.icon, opacity: highlight },
        ]}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 1,
  },
  button: {
    flexShrink: 1,
  },
  // Over the drawn pill, which sits centered in its 44-point target.
  highlight: {
    position: "absolute",
    top: (READER_TOUCH_TARGET - READER_GLASS_SIZE) / 2,
    bottom: (READER_TOUCH_TARGET - READER_GLASS_SIZE) / 2,
    left: 0,
    right: 0,
    borderRadius: READER_GLASS_SIZE / 2,
  },
})
