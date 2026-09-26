import { Pressable, StyleSheet, Text, View } from "react-native"

import { READER_TOUCH_TARGET } from "../../lib/bible/reader/chrome"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

export type ReaderMessageAction = { label: string; onPress: () => void }

type ReaderMessageProps = {
  tokens: ReaderTokens
  title: string
  body: string
  actions: readonly ReaderMessageAction[]
}

/** R31's message in the verse area, with its retry and its switch. */
export function ReaderMessage({
  tokens,
  title,
  body,
  actions,
}: ReaderMessageProps) {
  return (
    <View
      testID="bible-reader-message"
      style={styles.message}
      accessibilityLiveRegion="polite"
    >
      <Text
        style={[styles.title, { color: tokens.text }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <Text style={[styles.body, { color: tokens.secondaryText }]}>{body}</Text>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={[styles.action, { backgroundColor: tokens.buttonSurface }]}
          >
            <Text style={[styles.actionText, { color: tokens.text }]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  message: {
    maxWidth: 420,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "System",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    marginTop: 4,
  },
  action: {
    minWidth: READER_TOUCH_TARGET,
    minHeight: READER_TOUCH_TARGET,
    paddingHorizontal: 20,
    borderRadius: READER_TOUCH_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: "System",
  },
})
