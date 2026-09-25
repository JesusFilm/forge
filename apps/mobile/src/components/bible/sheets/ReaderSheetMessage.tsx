import { Pressable, StyleSheet, Text, View } from "react-native"

import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import { readerSheetControlColors } from "../../../lib/bible/sheets/theme"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { feedback, HORIZONTAL_PADDING } from "../../../styles/shared"
import { ReaderSheetHeader } from "./ReaderSheetHeader"

export type ReaderSheetMessageProps = {
  tokens: ReaderTokens
  sheetTitle: string
  title: string
  body: string
  action: { label: string; onPress: () => void }
  onClose: () => void
}

/** A sheet that cannot show its content says why and offers one action. */
export function ReaderSheetMessage({
  tokens,
  sheetTitle,
  title,
  body,
  action,
  onClose,
}: ReaderSheetMessageProps) {
  const controls = readerSheetControlColors(tokens)
  return (
    <View style={[styles.root, { backgroundColor: tokens.background }]}>
      <ReaderSheetHeader tokens={tokens} title={sheetTitle} onClose={onClose} />
      <View style={styles.message}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: tokens.text }]}
        >
          {title}
        </Text>
        <Text style={[styles.body, { color: tokens.secondaryText }]}>
          {body}
        </Text>
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: controls.selectedFill },
            pressed && feedback.pressed,
          ]}
        >
          <Text style={[styles.actionText, { color: controls.selectedText }]}>
            {action.label}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 20,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  message: {
    paddingTop: 32,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontFamily: "System",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    fontFamily: "System",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  action: {
    minHeight: READER_TOUCH_TARGET,
    paddingHorizontal: 20,
    borderRadius: READER_TOUCH_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  actionText: {
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
})
