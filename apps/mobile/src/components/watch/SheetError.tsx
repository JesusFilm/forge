import { Pressable, StyleSheet, Text, View } from "react-native"

import { ACCENT } from "../../lib/color"

/**
 * formSheet shown when the dub's media fetch FAILED (distinct from a dub with
 * legitimately no downloads/subtitles, which renders empty). Offers retry
 * instead of a misleading "nothing here" state.
 */
export function SheetError({
  message = "Couldn't load. Check your connection and try again.",
  onRetry,
}: {
  message?: string
  onRetry: () => void
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onRetry}
        style={styles.retryButton}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        hitSlop={8}
      >
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: "center",
    gap: 16,
  },
  message: {
    color: "#a8a29e",
    fontFamily: "System",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 21,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  retryText: {
    color: ACCENT,
    fontFamily: "System",
    fontSize: 15,
    fontWeight: "600",
  },
})
