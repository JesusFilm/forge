import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import { READER_SHEET_COPY } from "../../../lib/bible/sheets/copy"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { feedback } from "../../../styles/shared"

export type ReaderSheetHeaderProps = {
  tokens: ReaderTokens
  title: string
  onClose: () => void
  /** The previous step of a multi-step sheet. */
  back?: { label: string; onPress: () => void }
}

// A title and a Close button. The button is the no-gesture way out of the
// sheet (PRODUCT.md): the grabber and the swipe need a precise gesture.
export function ReaderSheetHeader({
  tokens,
  title,
  onClose,
  back,
}: ReaderSheetHeaderProps) {
  return (
    <View style={styles.row}>
      {back && (
        <Pressable
          onPress={back.onPress}
          accessibilityRole="button"
          accessibilityLabel={READER_SHEET_COPY.passage.goBackTo(back.label)}
          style={({ pressed }) => [styles.back, pressed && feedback.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.icon} />
          <Text
            style={[styles.backLabel, { color: tokens.text }]}
            numberOfLines={1}
          >
            {back.label}
          </Text>
        </Pressable>
      )}
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: tokens.text }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={READER_SHEET_COPY.close}
        hitSlop={4}
        style={({ pressed }) => [styles.close, pressed && feedback.pressed]}
      >
        <Ionicons name="close" size={24} color={tokens.secondaryText} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: READER_TOUCH_TARGET,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: READER_TOUCH_TARGET,
    paddingRight: 8,
    marginLeft: -6,
  },
  backLabel: {
    fontFamily: "System",
    fontSize: 16,
  },
  title: {
    flex: 1,
    fontFamily: "System",
    fontSize: 18,
    fontWeight: "600",
  },
  close: {
    width: READER_TOUCH_TARGET,
    height: READER_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
})
