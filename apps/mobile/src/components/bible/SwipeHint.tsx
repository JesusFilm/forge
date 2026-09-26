import { useEffect, useState } from "react"
import { Animated, Easing, StyleSheet, Text } from "react-native"

import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_HINT_ROW_HEIGHT,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

/** R15: fade in, three gentle bounces over about 3 seconds, fade out. */
export const SWIPE_HINT_MS = 3600

const FADE = 0.1
const BOUNCES = 3
const BOUNCE_HEIGHT = 6

// One value drives the whole hint: a sequence inside a parallel can fail to
// run on Fabric. The bounce points fill the time between the two fades.
const BOUNCE_INPUT = Array.from(
  { length: BOUNCES * 2 + 1 },
  (_, index) => FADE + ((1 - 2 * FADE) * index) / (BOUNCES * 2),
)
const BOUNCE_OUTPUT = BOUNCE_INPUT.map((_, index) =>
  index % 2 === 1 ? -BOUNCE_HEIGHT : 0,
)

export type SwipeHintProps = {
  tokens: ReaderTokens
  reduceMotion: boolean
  /** A new value plays the hint once (one per reader open); null waits. */
  playKey: number | null
}

type Phase = "waiting" | "showing" | "faded"

export function SwipeHint({ tokens, reduceMotion, playKey }: SwipeHintProps) {
  const [progress] = useState(() => new Animated.Value(0))
  const [phase, setPhase] = useState<Phase>("waiting")

  useEffect(() => {
    if (playKey === null) return
    progress.setValue(0)
    setPhase("showing")
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SWIPE_HINT_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) setPhase("faded")
    })
    return () => animation.stop()
  }, [playKey, progress])

  const opacity = progress.interpolate({
    inputRange: [0, FADE, 1 - FADE, 1],
    outputRange: [0, 1, 1, 0],
  })
  const bounce = progress.interpolate({
    inputRange: BOUNCE_INPUT,
    outputRange: BOUNCE_OUTPUT,
  })
  // A hint the viewer cannot see is not in the accessibility tree (KTD14).
  const visible = phase === "showing"

  return (
    <Animated.View
      testID="bible-swipe-hint"
      pointerEvents="none"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={[
        styles.hint,
        { opacity },
        !reduceMotion && { transform: [{ translateY: bounce }] },
      ]}
    >
      <Text
        style={[styles.text, { color: tokens.secondaryText }]}
        numberOfLines={1}
        maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
      >
        {READER_COPY.movement.hint}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  hint: {
    height: READER_HINT_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 24,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "System",
    textAlign: "center",
  },
})
