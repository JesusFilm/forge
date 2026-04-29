import { LinearGradient } from "expo-linear-gradient"
import { Image } from "expo-image"
import { StyleSheet, Text, View } from "react-native"

import { type SearchResult } from "../../lib/queries"
import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"

type Props = {
  result: SearchResult
  onPress: (result: SearchResult) => void
  onFocus?: () => void
  /** When true, this card claims focus on mount. The SearchResultsGrid
   *  assigns this to the first result after results land. */
  hasTVPreferredFocus?: boolean
}

const CARD_IMAGE_HEIGHT = scale(158)

/**
 * Single search-result tile. Visually matches the home rail's
 * FocusableCard + image + title treatment, so results feel continuous
 * with the rest of the app.
 *
 * onFocus and hasTVPreferredFocus are passed through to the underlying
 * FocusableCard so the SearchResultsGrid can orchestrate focus claims
 * without this component knowing about the grid layout.
 */
export function ResultCard({
  result,
  onPress,
  onFocus,
  hasTVPreferredFocus,
}: Props) {
  const imageUrl = resolveImageUrl(result.imageUrl)
  // Close over `result` rather than re-indexing by id in onFocus /
  // onPress — Apollo cache changes can shrink the results array
  // between render and callback invocation. See
  // docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md.
  const handlePress = () => onPress(result)

  return (
    <FocusableCard
      onPress={handlePress}
      onFocus={onFocus}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={result.title}
      accessibilityHint="Opens this experience"
      style={styles.card}
    >
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
      {/* Cinematic title plate: vertical gradient from the lightest
          surface container at the seam where the image ends down to
          the darkest surface tone at the bottom of the card. The
          gradient creates a "fading into shadow" feel and ALSO makes
          the card visibly distinct from the right pane's solid
          surfaceContainer background, which used to be the same
          color and made cards blend into the panel. */}
      <LinearGradient
        colors={[
          hexToRgba(COLORS.surfaceContainerHighest, 1),
          hexToRgba(COLORS.surface, 1),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.textContainer}
      >
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        {result.snippet.length > 0 ? (
          <Text style={styles.snippet} numberOfLines={2}>
            {result.snippet}
          </Text>
        ) : null}
      </LinearGradient>
    </FocusableCard>
  )
}

const styles = StyleSheet.create({
  card: {
    // Fill whatever width its parent (the cell wrapper in
    // SearchResultsGrid) allots — the wrapper is set to 25% of the
    // row so 4 cards occupy the full panel width with equal left
    // and right gutters. A fixed CARD_WIDTH would leave dead space
    // on the right.
    flex: 1,
    // Use the lightest surface tone behind the card so any pixel
    // not covered by the image or the text-area gradient still reads
    // as "card", not "panel". The image covers the top portion and
    // the gradient covers the rest, but the bg shows through the
    // borderRadius corners while the focus animation runs.
    backgroundColor: COLORS.surfaceContainerHighest,
    overflow: "hidden",
  },
  image: {
    // Stretches to the card's full width (parent View defaults to
    // alignItems: "stretch" in column-flex direction). Height stays
    // fixed so cards are uniform vertically regardless of how wide
    // the panel becomes.
    width: "100%",
    height: CARD_IMAGE_HEIGHT,
    borderTopLeftRadius: scale(16),
    borderTopRightRadius: scale(16),
  },
  imageFallback: {
    backgroundColor: COLORS.surfaceContainerHigh,
  },
  textContainer: {
    padding: scale(12),
    gap: scale(4),
  },
  title: {
    fontFamily: "System",
    // Bumped from scale(16) to scale(18). Title-to-snippet ratio is
    // now 18/12 = 1.5, well above the impeccable design law's
    // ≥1.25 hierarchy ratio. Pairs with the existing color contrast
    // (full text vs muted) for a clearer information hierarchy.
    fontSize: scale(18),
    fontWeight: "600",
    color: COLORS.text,
  },
  snippet: {
    fontFamily: "System",
    fontSize: scale(12),
    // Tighter line-height than RN's default (~1.4×) so the snippet
    // reads as supporting metadata, not as a second equal-weight
    // headline competing with the title above.
    lineHeight: scale(15),
    color: COLORS.muted,
  },
})
