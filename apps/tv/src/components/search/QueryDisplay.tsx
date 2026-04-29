import { StyleSheet, Text, View } from "react-native"

import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"

type Props = {
  value: string
}

/**
 * Read-only display of the current search query. Sits above the
 * on-screen keyboard inside the left pane. Not focusable — the user
 * modifies the query via SearchKeyboard key presses.
 *
 * Placeholder copy ("Type to search") renders at muted color when
 * the value is empty. Per doc-review P2 (contrast), muted color is
 * intentionally used for the placeholder despite ~3.4:1 contrast
 * against the surface — the plain text value renders at full
 * contrast (#F5F5F4) once typing begins, and the placeholder is
 * transient.
 */
export function QueryDisplay({ value }: Props) {
  const isPlaceholder = value.length === 0
  return (
    <View style={styles.container}>
      <Text
        style={[styles.text, isPlaceholder && styles.placeholder]}
        numberOfLines={1}
        accessibilityLabel={
          isPlaceholder ? "Search query, empty" : `Search query, ${value}`
        }
      >
        {isPlaceholder ? "Type to search" : value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surfaceContainer,
    paddingHorizontal: scale(20),
    paddingVertical: scale(16),
    borderRadius: scale(16),
    marginBottom: scale(16),
  },
  text: {
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "500",
    color: COLORS.text,
  },
  placeholder: {
    color: COLORS.muted,
    fontWeight: "400",
  },
})
