import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_FOOTER_ROWS,
  READER_TOUCH_TARGET,
  readerFooterHeight,
  type ReaderLayout,
} from "../../lib/bible/reader/chrome"
import { READER_COPY } from "../../lib/bible/reader/copy"
import type { TranslationLabel } from "../../lib/bible/reader/labels"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

export type ReaderFooterProps = {
  tokens: ReaderTokens
  layout: ReaderLayout
  bottomInset: number
  /** "John 3" in the shown translation, or null while waiting. */
  heading: string | null
  counter: { text: string; accessibilityLabel: string } | null
  /** U9's VerseScrubber: it draws the progress bar and owns its touches. */
  scrubber: ReactNode
  translation: TranslationLabel | null
  onPressTranslation: () => void
}

// R9's footer. Its height is fixed (chrome.ts), so the verse box and the
// mini player can read it without a layout pass.
export function ReaderFooter({
  tokens,
  layout,
  bottomInset,
  heading,
  counter,
  scrubber,
  translation,
  onPressTranslation,
}: ReaderFooterProps) {
  const secondary = { color: tokens.secondaryText }
  const credit = (
    <Text
      style={[styles.credit, secondary]}
      numberOfLines={1}
      maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
    >
      {READER_COPY.stillCredit}
    </Text>
  )
  const translationButton = translation ? (
    <Pressable
      onPress={onPressTranslation}
      accessibilityRole="button"
      accessibilityLabel={translation.accessibilityLabel}
      style={styles.translation}
    >
      {translation.isFallback && (
        <Ionicons
          name="information-circle-outline"
          size={16}
          color={tokens.text}
        />
      )}
      <Text
        style={[
          styles.translationText,
          {
            color: translation.isFallback ? tokens.text : tokens.secondaryText,
          },
        ]}
        numberOfLines={1}
        maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
      >
        {translation.text}
      </Text>
    </Pressable>
  ) : null

  return (
    <View
      testID="bible-reader-footer"
      style={[
        styles.footer,
        {
          height: readerFooterHeight(layout) + bottomInset,
          paddingBottom: bottomInset + READER_FOOTER_ROWS.paddingBottom,
        },
      ]}
    >
      <View style={styles.column}>
        <View style={styles.heading}>
          <Text
            style={[styles.label, secondary]}
            numberOfLines={1}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          >
            {heading ?? ""}
          </Text>
          {counter && (
            <Text
              style={[styles.label, styles.counter, secondary]}
              accessibilityLabel={counter.accessibilityLabel}
              maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
            >
              {counter.text}
            </Text>
          )}
        </View>
        {/* The scrubber layer below draws the bar over this row. */}
        <View style={styles.progressRow} />
        {layout === "tablet" ? (
          <View style={styles.bottomRow}>
            {translationButton ?? <View />}
            {credit}
          </View>
        ) : (
          <>
            <View style={styles.translationRow}>{translationButton}</View>
            <View style={styles.creditRow}>{credit}</View>
          </>
        )}
      </View>
      {/* Last, so it sits on top. Only the thumb's target takes touches. */}
      <View pointerEvents="box-none" style={styles.scrubberLayer}>
        <View pointerEvents="box-none" style={styles.column}>
          {scrubber}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: READER_FOOTER_ROWS.paddingTop,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  column: {
    width: "100%",
    maxWidth: 560,
  },
  heading: {
    height: READER_FOOTER_ROWS.heading,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "System",
    flexShrink: 1,
  },
  counter: {
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
  },
  progressRow: {
    height: READER_FOOTER_ROWS.progress,
  },
  // U9: the footer's top band, from its top edge to the progress row's bottom.
  scrubberLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  translationRow: {
    height: READER_FOOTER_ROWS.translation,
    alignItems: "center",
    justifyContent: "center",
  },
  creditRow: {
    height: READER_FOOTER_ROWS.credit,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomRow: {
    height: READER_FOOTER_ROWS.translation,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  translation: {
    minWidth: READER_TOUCH_TARGET,
    minHeight: READER_TOUCH_TARGET,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  translationText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    fontFamily: "System",
  },
  credit: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "System",
  },
})
