import { StyleSheet, Text, View } from "react-native"

import type { CatalogTranslation } from "../../../lib/bible/data/catalog"
import { READER_CHROME_MAX_FONT_SCALE } from "../../../lib/bible/reader/chrome"
import { downloadLabel } from "../../../lib/bible/reader/labels"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import { formatDownloadSize } from "../../../lib/bible/sheets/downloadPrompt"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { BSB_TRANSLATION_ID } from "../../../lib/bible/versification/classify"
import { ReaderGlassButton } from "../ReaderGlassButton"
import { ReaderDownloadGlyph } from "./ReaderDownloadGlyph"

export type TranslationDownloadButtonProps = {
  tokens: ReaderTokens
  translation: CatalogTranslation
  state: TranslationDownloadState
  onPress: () => void
}

// The owner (2026-10-01): the download button moved from the top bar onto the
// Current card, so long book names fit the top bar. Same glyphs and prompt as
// before; BSB is inside the app (R30), so it has no button.
export function TranslationDownloadButton({
  tokens,
  translation,
  state,
  onPress,
}: TranslationDownloadButtonProps) {
  if (translation.id === BSB_TRANSLATION_ID || state.kind === "bundled") {
    return null
  }
  // The size says what a download costs, so it shows only before one.
  const showSize = state.kind === "not-downloaded" || state.kind === "checking"
  return (
    <View style={styles.column}>
      <ReaderGlassButton
        testID="translation-download-button"
        tokens={tokens}
        accessibilityLabel={downloadLabel(state, translation)}
        onPress={onPress}
      >
        <ReaderDownloadGlyph state={state} tokens={tokens} />
      </ReaderGlassButton>
      {showSize && (
        <Text
          style={[styles.size, { color: tokens.secondaryText }]}
          maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
          // The prompt says the size too; this is for the eye.
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {formatDownloadSize(translation.downloadBytes)}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    alignItems: "center",
  },
  size: {
    fontFamily: "System",
    fontSize: 12,
    lineHeight: 16,
  },
})
