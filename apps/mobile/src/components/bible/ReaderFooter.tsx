import type { ReactNode } from "react"
import { StyleSheet, Text, View } from "react-native"

import {
  READER_CHROME_MAX_FONT_SCALE,
  READER_FOOTER_ROWS,
  readerFooterHeight,
} from "../../lib/bible/reader/chrome"
import {
  BIBLE_NOTICES,
  BIBLE_NOTICE_LANGUAGE,
} from "../../lib/bible/sheets/copy"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"

export type ReaderFooterProps = {
  tokens: ReaderTokens
  bottomInset: number
  /** "John 3" in the shown translation, or null while waiting. */
  heading: string | null
  counter: { text: string; accessibilityLabel: string } | null
  /** U9's VerseScrubber: it draws the progress bar and owns its touches. */
  scrubber: ReactNode
}

// R9's footer. Its height is fixed (chrome.ts), so the verse box and the
// mini player can read it without a layout pass. The translation pill is in
// the top bar (owner, 2026-09-27).
export function ReaderFooter({
  tokens,
  bottomInset,
  heading,
  counter,
  scrubber,
}: ReaderFooterProps) {
  const secondary = { color: tokens.secondaryText }
  return (
    <View
      testID="bible-reader-footer"
      style={[
        styles.footer,
        {
          height: readerFooterHeight() + bottomInset,
          paddingBottom: bottomInset + READER_FOOTER_ROWS.paddingBottom,
        },
      ]}
    >
      <View style={[styles.column, styles.fill]}>
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
        {/* The credit centers in the room kept for the selection bar. */}
        <View style={styles.creditRow}>
          {/* KTD17: the credit stays English, so it is read as English. */}
          <Text
            testID="bible-reader-credit"
            style={[styles.credit, secondary]}
            numberOfLines={1}
            maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
            accessibilityLanguage={BIBLE_NOTICE_LANGUAGE}
          >
            {BIBLE_NOTICES.stillCredit}
          </Text>
        </View>
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
  // Only the main column fills the footer; the scrubber layer has no height.
  fill: {
    flex: 1,
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
  creditRow: {
    flexGrow: 1,
    minHeight: READER_FOOTER_ROWS.credit,
    alignItems: "center",
    justifyContent: "center",
  },
  credit: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "System",
  },
})
