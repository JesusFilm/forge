import { Image } from "expo-image"
import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"

import { type SearchResult } from "../../lib/queries"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import { resultChipLabel, resultKindLabel } from "./searchDisplay"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  result: SearchResult
  onPress: (result: SearchResult) => void
  onFocus?: () => void
  /** When true, this card claims focus on mount. The SearchResultsGrid
   *  assigns this to the first result after results land. */
  hasTVPreferredFocus?: boolean
  /**
   * Forced D-pad-up destination. The stacked (Apple TV) layout wires the
   * grid's TOP ROW to the keyboard's first key so up-escape out of the
   * vertically-scrolling grid lands deterministically on the keyboard.
   * Undefined elsewhere (and in the two-pane layout) → default geometry.
   */
  nextFocusUp?: ViewType | null
}

/**
 * Single search-result tile (design: .card in the s-grid). 16:9 art with
 * a 1px outline and an episode-count chip, labels below the art (title +
 * kind line). Focus lifts the card (translateY −8, scale 1.06), swaps the
 * title to full white, and draws a 5px white ring + deep shadow on the
 * thumb.
 *
 * onFocus and hasTVPreferredFocus pass through so SearchResultsGrid can
 * orchestrate focus claims without this component knowing the grid layout.
 */
export function ResultCard({
  result,
  onPress,
  onFocus,
  hasTVPreferredFocus,
  nextFocusUp,
}: Props) {
  const imageUrl = resolveImageUrl(result.imageUrl)
  const chip = resultChipLabel(result)
  const kind = resultKindLabel(result)

  // Close over `result` rather than re-indexing by id in onFocus /
  // onPress — Apollo cache changes can shrink the results array
  // between render and callback invocation. See
  // docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md.
  const handlePress = () => onPress(result)

  // Focus lift driven by the shared useFocusAnimation hook (same as
  // HomeCard): one 0→1 `progress` feeds focusTransform (native-driver
  // translateY + scale), and it stops the prior timing before starting
  // the next so a rapid D-pad sweep can't orphan animations. `focused`
  // gates the non-animated focus styles (shadow, ring, title color).
  const { focused, setFocused, progress } = useFocusAnimation()

  // Memoized: progress is a stable ref, so the interpolations are built
  // once rather than on every focus/blur re-render.
  const liftStyle = useMemo(
    () => ({
      transform: focusTransform(progress, { lift: scale(8), magnify: 1.06 }),
    }),
    [progress],
  )

  return (
    <Pressable
      onPress={handlePress}
      onFocus={() => {
        setFocused(true)
        onFocus?.()
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      accessibilityRole="button"
      accessibilityLabel={result.title}
      accessibilityHint="Opens this experience"
      testID={`search-result-${result.type}-${result.id}`}
    >
      {/* Width comes from the grid cell wrapper via cross-axis stretch;
          height is content-driven (16:9 art + two text lines). */}
      <Animated.View style={liftStyle}>
        {/* Outer/inner split (same pattern as FocusableCard): iOS sets
            masksToBounds for overflow:"hidden", which would clip the
            focused layer's own shadow — so the shadow lives on this
            non-clipping wrapper and the art clips inside. */}
        <View style={[styles.thumbShadow, focused && styles.thumbFocused]}>
          <View style={styles.thumb}>
            {imageUrl != null ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.image}
                contentFit="cover"
                recyclingKey={`search-${result.type}-${result.id}`}
              />
            ) : (
              <View style={[styles.image, styles.imageFallback]} />
            )}
            {chip != null ? (
              <View style={styles.chip} pointerEvents="none">
                <Text style={styles.chipText}>{chip}</Text>
              </View>
            ) : null}
          </View>
          {/* Focus ring — decorative overlay, NOT a focusable. Drawn as
              an absolute inset border so toggling it never reflows the
              image underneath (a borderWidth change on the thumb itself
              would shrink the art by 2×ring while focused). */}
          {focused ? <View style={styles.ring} pointerEvents="none" /> : null}
        </View>
        <View style={styles.meta}>
          <Text
            style={[styles.title, focused && styles.titleFocused]}
            numberOfLines={1}
          >
            {result.title}
          </Text>
          <Text style={styles.kind} numberOfLines={1}>
            {kind}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  thumbShadow: {
    width: "100%",
    // Design thumb is 400×225 — exactly 16:9 — expressed as a ratio so
    // the fluid cell width keeps the art proportionate.
    aspectRatio: 16 / 9,
    borderRadius: scale(16),
    // Solid bg gives the iOS shadow a clean opaque shape to project.
    backgroundColor: SEARCH_THEME.bg,
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: scale(16),
    borderWidth: 1,
    borderColor: SEARCH_THEME.thumbBorder,
    overflow: "hidden",
    backgroundColor: SEARCH_THEME.keyBg,
  },
  thumbFocused: {
    // Design: 0 24px 50px -16px rgba(0,0,0,.8).
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: scale(20) },
    shadowRadius: scale(25),
    shadowOpacity: 0.8,
    elevation: 12,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageFallback: {
    backgroundColor: SEARCH_THEME.keyBg,
  },
  chip: {
    position: "absolute",
    top: scale(12),
    right: scale(12),
    backgroundColor: SEARCH_THEME.chipBg,
    paddingHorizontal: scale(10),
    paddingVertical: scale(4),
    borderRadius: scale(8),
  },
  chipText: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    fontWeight: "600",
    color: SEARCH_THEME.text,
  },
  ring: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: scale(16),
    borderWidth: scale(5),
    borderColor: SEARCH_THEME.ring,
  },
  meta: {
    paddingTop: scale(12),
    paddingHorizontal: scale(4),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "600",
    letterSpacing: scale(-0.2),
    color: SEARCH_THEME.textDim(0.85),
  },
  titleFocused: {
    color: SEARCH_THEME.text,
  },
  kind: {
    fontFamily: "System",
    fontSize: Math.round(scale(17)),
    fontWeight: "500",
    color: SEARCH_THEME.textDim(0.45),
    marginTop: scale(3),
  },
})
