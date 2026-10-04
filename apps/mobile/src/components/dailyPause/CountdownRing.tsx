// The Pray ring (R16, KTD18). The frame draws a 114 x 109 ellipse, a circle
// out of shape, so this draws a circle 114 across that empties clockwise from
// 12 o'clock. The app has no SVG, so two half rings turn in half-width clips.
import { memo, useEffect, useState } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { spokenTimeLeft, type Countdown } from "../../lib/dailyPause/countdown"
import { pauseColors, pauseSizes } from "../../lib/dailyPause/theme"
import type { PauseFont } from "./WatchScreen"

const SIZE = pauseSizes.prayRingWidth
const RADIUS = SIZE / 2
const NUMERAL_SIZE = 48
/** The ring does not grow with the text, so the numeral stops at this scale
 *  to stay inside it. VoiceOver reads the time left in full. */
const NUMERAL_MAX_SCALE = 1.5

type CountdownRingProps = {
  countdown: Countdown
  font: PauseFont
}

export function CountdownRing({ countdown, font }: CountdownRingProps) {
  const reduceMotion = useReduceMotion()
  const { totalMs, msLeft, secondsLeft, running, runFromMs } = countdown
  const [fill] = useState(() => new Animated.Value(msLeft / totalMs))

  // Under Reduce Motion the ring steps once a second. Otherwise it stands
  // still while the time holds, and one native animation empties it per run.
  const still = reduceMotion
    ? (secondsLeft * 1000) / totalMs
    : running
      ? null
      : msLeft / totalMs
  useEffect(() => {
    if (still !== null) fill.setValue(still)
  }, [fill, still])

  const animateFromMs = reduceMotion ? null : runFromMs
  useEffect(() => {
    if (animateFromMs === null) return
    fill.setValue(animateFromMs / totalMs)
    const animation = Animated.timing(fill, {
      toValue: 0,
      duration: animateFromMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [fill, animateFromMs, totalMs])

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={spokenTimeLeft(secondsLeft)}
      style={styles.ring}
    >
      <RingHalves fill={fill} />
      <View style={styles.center}>
        <Text
          maxFontSizeMultiplier={NUMERAL_MAX_SCALE}
          style={[styles.numeral, font("display")]}
        >
          {String(secondsLeft)}
        </Text>
      </View>
    </View>
  )
}

// The numeral changes each second. The halves skip that render, so React
// never writes a stale value over the running native animation.
const RingHalves = memo(function RingHalves({
  fill,
}: {
  fill: Animated.Value
}) {
  // A circle with its top and right borders colored draws the arc from 10:30
  // to 4:30. Turned 45deg it is the right half. Each half turns out of its
  // clip in the half of the time that it stands for: the right half first.
  const [turns] = useState(() => ({
    right: fill.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: ["225deg", "225deg", "45deg"],
      extrapolate: "clamp",
    }),
    left: fill.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: ["405deg", "225deg", "225deg"],
      extrapolate: "clamp",
    }),
  }))

  return (
    <>
      <View style={[styles.clip, styles.rightClip]}>
        <Animated.View
          testID="countdown-ring-right"
          style={[
            styles.halfRing,
            { left: -RADIUS, transform: [{ rotate: turns.right }] },
          ]}
        />
      </View>
      <View style={[styles.clip, styles.leftClip]}>
        <Animated.View
          testID="countdown-ring-left"
          style={[
            styles.halfRing,
            { left: 0, transform: [{ rotate: turns.left }] },
          ]}
        />
      </View>
    </>
  )
})

const styles = StyleSheet.create({
  ring: { width: SIZE, height: SIZE },
  clip: { position: "absolute", top: 0, width: RADIUS, height: SIZE },
  rightClip: { left: RADIUS, overflow: "hidden" },
  leftClip: { left: 0, overflow: "hidden" },
  halfRing: {
    position: "absolute",
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: RADIUS,
    borderWidth: pauseSizes.prayRingStroke,
    borderTopColor: pauseColors.ink,
    borderRightColor: pauseColors.ink,
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
  },
  // No line height: a line box shorter than the face clips the numeral on
  // iOS. Centered in the ring, the face's own box puts the glyph where the
  // frame puts it.
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  numeral: {
    color: pauseColors.ringNumeral,
    fontSize: NUMERAL_SIZE,
    textAlign: "center",
  },
})
