import { Pressable, StyleSheet, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  READER_ARROW_ROW_HEIGHT,
  READER_GLASS_SIZE,
  READER_TOUCH_TARGET,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { ReaderGlassButton } from "./ReaderGlassButton"

export type ArrowPairProps = {
  tokens: ReaderTokens
  onPrevious: () => void
  onNext: () => void
}

// R11: the up/down pair above the footer, for viewers who do not swipe. The
// down button is the filled one, because the next verse is the usual move.
export function ArrowPair({ tokens, onPrevious, onNext }: ArrowPairProps) {
  return (
    <View testID="bible-arrow-pair" style={styles.row}>
      <ReaderGlassButton
        tokens={tokens}
        accessibilityLabel={READER_COPY.movement.previousVerse}
        onPress={onPrevious}
      >
        <Ionicons name="chevron-up" size={24} color={tokens.icon} />
      </ReaderGlassButton>
      <Pressable
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel={READER_COPY.movement.nextVerse}
        style={styles.target}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.filled,
              { backgroundColor: tokens.text },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="chevron-down" size={24} color={tokens.background} />
          </View>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    height: READER_ARROW_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  target: {
    minWidth: READER_TOUCH_TARGET,
    minHeight: READER_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  filled: {
    width: READER_GLASS_SIZE,
    height: READER_GLASS_SIZE,
    borderRadius: READER_GLASS_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    transform: [{ scale: 0.94 }],
  },
})
