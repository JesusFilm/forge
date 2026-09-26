import { useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { hexToRgba } from "../../lib/color"
import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_TOUCH_TARGET,
} from "../../lib/bible/reader/chrome"
import {
  SWIPE_DEMO_MS,
  demoOpacityKeyframes,
  partOpacityKeyframes,
  partTravelKeyframes,
  type SwipeDemoPart,
} from "../../lib/bible/onboarding/swipeDemoTimeline"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

/** The reader's accessibility reads land first, so a screen reader skips it. */
export const SWIPE_DEMO_DELAY_MS = 600

const TRAVEL = 80

type Part = {
  opacity: Animated.AnimatedInterpolation<number>
  travel: Animated.AnimatedInterpolation<number>
}

function part(progress: Animated.Value, name: SwipeDemoPart): Part {
  return {
    opacity: progress.interpolate({
      ...partOpacityKeyframes(name),
      extrapolate: "clamp",
    }),
    travel: progress.interpolate({
      ...partTravelKeyframes(name, TRAVEL),
      extrapolate: "clamp",
    }),
  }
}

export type SwipeDemoProps = {
  tokens: ReaderTokens
  /** The demo ended or the viewer skipped it; it never moves the reader. */
  onDone: () => void
}

// R16's first-run demonstration. One value drives every part, because a
// sequence inside a parallel can fail to run on Fabric.
export function SwipeDemo({ tokens, onDone }: SwipeDemoProps) {
  const [armed, setArmed] = useState(false)
  const [progress] = useState(() => new Animated.Value(0))
  const [parts] = useState(() => ({
    verse: part(progress, "verse"),
    chapter: part(progress, "chapter"),
    whole: progress.interpolate({
      ...demoOpacityKeyframes(),
      extrapolate: "clamp",
    }),
  }))
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), SWIPE_DEMO_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!armed) return
    progress.setValue(0)
    // The clock counts milliseconds, so the keyframes read as times.
    const animation = Animated.timing(progress, {
      toValue: SWIPE_DEMO_MS,
      duration: SWIPE_DEMO_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) done.current()
    })
    return () => animation.stop()
  }, [armed, progress])

  if (!armed) return null
  const { verse, chapter, whole } = parts

  return (
    <Animated.View
      testID="bible-swipe-demo-fade"
      style={[StyleSheet.absoluteFill, styles.layer, { opacity: whole }]}
    >
      <Pressable
        testID="bible-swipe-demo"
        onPress={() => done.current()}
        accessibilityRole="button"
        accessibilityLabel={READER_COPY.movement.demoSkipLabel}
        style={[
          StyleSheet.absoluteFill,
          styles.scrim,
          { backgroundColor: hexToRgba(tokens.background, 0.92) },
        ]}
      >
        <View style={styles.stage} pointerEvents="none">
          <Animated.View
            style={[
              styles.finger,
              {
                backgroundColor: tokens.text,
                opacity: verse.opacity,
                transform: [{ translateY: verse.travel }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.finger,
              {
                backgroundColor: tokens.text,
                opacity: chapter.opacity,
                transform: [{ translateX: chapter.travel }],
              },
            ]}
          />
        </View>
        <View style={styles.captions} pointerEvents="none">
          {[
            { text: READER_COPY.movement.demoVerse, opacity: verse.opacity },
            {
              text: READER_COPY.movement.demoChapter,
              opacity: chapter.opacity,
            },
          ].map((caption) => (
            <Animated.Text
              key={caption.text}
              style={[
                styles.caption,
                { color: tokens.text, opacity: caption.opacity },
              ]}
              maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
            >
              {caption.text}
            </Animated.Text>
          ))}
        </View>
        <Text
          style={[styles.skip, { color: tokens.secondaryText }]}
          maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
        >
          {READER_COPY.movement.demoSkip}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  layer: {
    zIndex: 3,
  },
  scrim: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  stage: {
    width: TRAVEL * 2,
    height: TRAVEL * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  finger: {
    position: "absolute",
    width: READER_TOUCH_TARGET,
    height: READER_TOUCH_TARGET,
    borderRadius: READER_TOUCH_TARGET / 2,
  },
  captions: {
    height: 56,
    alignSelf: "stretch",
    marginTop: 24,
  },
  caption: {
    position: "absolute",
    left: 0,
    right: 0,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
  },
  skip: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "System",
  },
})
