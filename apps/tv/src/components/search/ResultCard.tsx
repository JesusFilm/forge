import { Image } from "expo-image"
import { useMemo } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import type { View as ViewType } from "react-native"

import { type SearchResult } from "../../lib/queries"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import { useFocusVisual } from "../focus/useFocusVisual"
import { ExperienceFallback } from "./ExperienceFallback"
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
   * grid's TOP ROW to the keyboard's first key so up-escape lands there.
   * Undefined elsewhere (and in the two-pane layout) → default geometry.
   */
  nextFocusUp?: ViewType | null
}

/**
 * Single search-result tile: 16:9 art + episode-count chip + title/kind labels.
 * Focus lifts/whitens it; onFocus + hasTVPreferredFocus pass through so
 * SearchResultsGrid orchestrates focus claims without knowing the grid layout.
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

  // Close over `result`, not re-index by id: Apollo cache changes can shrink the
  // results array between render and callback. See
  // docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md.
  const handlePress = () => onPress(result)

  // Shared focus module ("thumb" role); `focused` gates the non-animated focus
  // styles (shadow, ring, title color).
  const { focused, setFocused, transform } = useFocusVisual("thumb", {
    nativeDriver: false,
  })

  const liftStyle = useMemo(() => ({ transform }), [transform])

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
      // Stable, low-cardinality RUM action name (auto-tracker would use the title).
      {...{ "dd-action-name": "search-result" }}
      accessibilityHint="Opens this experience"
      testID={`search-result-${result.type}-${result.id}`}
    >
      {/* Width comes from the grid cell wrapper via cross-axis stretch;
          height is content-driven (16:9 art + two text lines). */}
      <Animated.View style={liftStyle}>
        {/* Outer/inner split: iOS overflow:"hidden" (masksToBounds) would clip
            the focused shadow, so the shadow lives on this non-clipping wrapper
            and the art clips inside. */}
        <View style={[styles.thumbShadow, focused && styles.thumbFocused]}>
          <View style={styles.thumb}>
            {imageUrl != null ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.image}
                contentFit="cover"
                contentPosition="top left"
                recyclingKey={`search-${result.type}-${result.id}`}
              />
            ) : result.type === "EXPERIENCE" ? (
              <ExperienceFallback slug={result.slug} title={result.title} />
            ) : (
              <View style={[styles.image, styles.imageFallback]} />
            )}
            {chip != null ? (
              <View style={styles.chip} pointerEvents="none">
                <Text style={styles.chipText}>{chip}</Text>
              </View>
            ) : null}
          </View>
          {/* Focus ring: decorative absolute inset border so toggling it never
              reflows the art (a borderWidth change on the thumb would shrink it
              by 2×ring while focused). */}
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
    // Match the cinematic thumbnails (mobileCinematicHigh = 1280×600 = 32:15)
    // so cover doesn't side-crop the art; fluid cell width keeps it proportionate.
    aspectRatio: 32 / 15,
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
