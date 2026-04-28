import { Image } from "expo-image"
import { StyleSheet, Text, View } from "react-native"

import { type SearchResult } from "../../lib/queries"
import { COLORS } from "../../lib/colors"
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
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={2}>
          {result.title}
        </Text>
        {result.snippet.length > 0 ? (
          <Text style={styles.snippet} numberOfLines={2}>
            {result.snippet}
          </Text>
        ) : null}
      </View>
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
    backgroundColor: COLORS.surfaceContainer,
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
    fontSize: scale(16),
    fontWeight: "600",
    color: COLORS.text,
  },
  snippet: {
    fontFamily: "System",
    fontSize: scale(12),
    color: COLORS.muted,
  },
})
