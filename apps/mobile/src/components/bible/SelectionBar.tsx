import { useEffect, useState, type ComponentProps } from "react"
import { AccessibilityInfo, Share, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as Clipboard from "expo-clipboard"

import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_FOOTER_ROWS,
  readerFooterHeight,
  type ReaderLayout,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { ReaderGlassButton } from "./ReaderGlassButton"

/** "Copied" shows this long after a copy. */
export const SELECTION_COPIED_MS = 2000

export type SelectionBarProps = {
  tokens: ReaderTokens
  layout: ReaderLayout
  bottomInset: number
  /** "John 3:16-17", in the shown translation's numbers (R42). */
  reference: string
  /** The one text that Copy and Share send (shareText.ts). */
  text: string
  onClear: () => void
}

// R19's bar. It takes the footer's place at the footer's height, so the verse
// box and the mini player do not move (after SelectionActionBar.tsx).
export function SelectionBar({
  tokens,
  layout,
  bottomInset,
  reference,
  text,
  onClear,
}: SelectionBarProps) {
  // Keyed by the text, so a changed selection never reads as copied.
  const [copied, setCopied] = useState<{ text: string } | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), SELECTION_COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const showCopied = copied?.text === text

  const copy = () => {
    void Clipboard.setStringAsync(text).then(
      (done) => {
        if (!done) return
        setCopied({ text })
        AccessibilityInfo.announceForAccessibility(READER_COPY.selection.copied)
      },
      () => {},
    )
  }
  const share = () => {
    // Share.share rejects when the sheet is dismissed or not available.
    void Share.share({ message: text, title: reference }).catch(() => {})
  }

  const words = READER_COPY.selection
  return (
    <View
      testID="bible-selection-bar"
      style={[
        styles.bar,
        {
          height: readerFooterHeight(layout) + bottomInset,
          paddingBottom: bottomInset + READER_FOOTER_ROWS.paddingBottom,
        },
      ]}
    >
      <View style={styles.column}>
        <Text
          style={[styles.reference, { color: tokens.text }]}
          accessibilityLabel={words.selected(reference)}
          numberOfLines={1}
          maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
        >
          {reference}
        </Text>
        <View style={styles.actions}>
          <BarButton
            tokens={tokens}
            icon={showCopied ? "checkmark" : "copy-outline"}
            label={showCopied ? words.copied : words.copy}
            accessibilityLabel={words.copyLabel(reference)}
            onPress={copy}
          />
          <BarButton
            tokens={tokens}
            icon="share-outline"
            label={words.share}
            accessibilityLabel={words.shareLabel(reference)}
            onPress={share}
          />
          <BarButton
            tokens={tokens}
            icon="close"
            label={words.clear}
            accessibilityLabel={words.clearLabel}
            onPress={onClear}
          />
        </View>
      </View>
    </View>
  )
}

type BarButtonProps = {
  tokens: ReaderTokens
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  accessibilityLabel: string
  onPress: () => void
}

function BarButton({
  tokens,
  icon,
  label,
  accessibilityLabel,
  onPress,
}: BarButtonProps) {
  return (
    <ReaderGlassButton
      tokens={tokens}
      shape="pill"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.action}
    >
      <Ionicons name={icon} size={18} color={tokens.icon} />
      <Text
        style={[styles.actionText, { color: tokens.text }]}
        numberOfLines={1}
        maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </ReaderGlassButton>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: READER_FOOTER_ROWS.paddingTop,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  column: {
    width: "100%",
    maxWidth: 560,
    gap: 8,
  },
  reference: {
    height: READER_FOOTER_ROWS.heading,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: "System",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  // A narrow phone or a large text size shortens a label; the row never spills.
  action: {
    flexShrink: 1,
  },
  actionText: {
    flexShrink: 1,
    marginLeft: 6,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: "System",
  },
})
