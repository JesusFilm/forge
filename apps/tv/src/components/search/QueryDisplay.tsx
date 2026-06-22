import { useEffect, useMemo, useRef } from "react"
import { Animated, Easing, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  value: string
}

/**
 * The big query line at the top of the search layer (design: .s-query).
 * Read-only — the user modifies the query via the letter strip below.
 * Typed text renders white at display weight; the placeholder ("Titles,
 * series, topics") sits at 25% white so it reads as a prompt, not a value.
 * A blinking accent caret trails the text.
 *
 * Fixed minHeight so the line doesn't shift the strip below when the
 * query transitions between empty and non-empty.
 */
export function QueryDisplay({ value }: Props) {
  const isPlaceholder = value.length === 0

  // Caret blink. Fabric gotcha: a looped Animated.sequence runs once and
  // a JS-driver loop never updates views — use a single looped timing on
  // the native driver and step the opacity via interpolation (mirrors the
  // design's `steps(2)` keyframe: visible first half, hidden second half).
  const blink = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(blink, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [blink])
  // Memoized: blink is a stable ref, so the interpolation is built once
  // rather than rebuilt on every keystroke re-render.
  const caretOpacity = useMemo(
    () =>
      blink.interpolate({
        inputRange: [0, 0.4999, 0.5, 1],
        outputRange: [1, 1, 0, 0],
      }),
    [blink],
  )

  // The caret marks the insertion point: LEADING (left of the placeholder)
  // while the query is empty, TRAILING (after the typed text) once the user
  // starts typing — so it always blinks where the next character will land.
  const caret = (
    <Animated.View
      style={[
        styles.caret,
        isPlaceholder ? styles.caretLeading : styles.caretTrailing,
        { opacity: caretOpacity },
      ]}
    />
  )

  return (
    <View style={styles.container}>
      {isPlaceholder && caret}
      <Text
        style={[styles.text, isPlaceholder && styles.placeholder]}
        numberOfLines={1}
        accessibilityLabel={
          isPlaceholder ? "Search query, empty" : `Search query, ${value}`
        }
      >
        {isPlaceholder ? "Titles, series, topics" : value}
      </Text>
      {!isPlaceholder && caret}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    // Caret height (56) + breathing room — keeps the line stable whether
    // the Text is the 56px query or the placeholder.
    minHeight: scale(70),
  },
  text: {
    fontFamily: "System",
    fontSize: Math.round(scale(56)),
    fontWeight: "800",
    letterSpacing: scale(-1),
    color: SEARCH_THEME.text,
    // Let a long query shrink the caret's room rather than push it
    // off-canvas.
    flexShrink: 1,
  },
  placeholder: {
    color: SEARCH_THEME.textDim(0.25),
    fontWeight: "700",
  },
  caret: {
    width: scale(4),
    height: scale(56),
    borderRadius: scale(2),
    backgroundColor: WATCH_THEME.accent,
  },
  // Trailing: a hairline gap after the last typed glyph. Leading: a hairline
  // gap before the placeholder text when the query is empty.
  caretTrailing: {
    marginLeft: scale(3),
  },
  caretLeading: {
    marginRight: scale(3),
  },
})
