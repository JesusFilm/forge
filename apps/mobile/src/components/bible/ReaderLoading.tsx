import { ActivityIndicator, StyleSheet, View } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

/** A quiet chapter-load indicator. Reduce Motion shows three still dots. */
export function ReaderLoading({ tokens }: { tokens: ReaderTokens }) {
  const reduceMotion = useReduceMotion()
  return (
    <View
      testID="bible-reader-loading"
      style={styles.loading}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={READER_COPY.loading}
    >
      {reduceMotion ? (
        <View style={styles.dots}>
          {[0, 1, 2].map((dot) => (
            <View
              key={dot}
              style={[styles.dot, { backgroundColor: tokens.secondaryText }]}
            />
          ))}
        </View>
      ) : (
        <ActivityIndicator color={tokens.secondaryText} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    flexDirection: "row",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
})
