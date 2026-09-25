import type { ComponentProps } from "react"
import { StyleSheet, Text } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { READER_CHROME_MAX_FONT_SCALE } from "../../../lib/bible/reader/chrome"
import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"

type IconName = ComponentProps<typeof Ionicons>["name"]

export function downloadGlyphIcon(
  state: TranslationDownloadState | null,
): IconName {
  switch (state?.kind) {
    case "bundled":
    case "downloaded":
      return "cloud-done-outline"
    case "failed":
      return "alert-circle-outline"
    default:
      return "cloud-download-outline"
  }
}

/** "45%" while a download runs, else null. */
export function downloadProgressText(
  state: TranslationDownloadState | null,
): string | null {
  if (state?.kind !== "downloading") return null
  const percent = Math.min(Math.max(Math.round(state.percent), 0), 100)
  return `${percent}%`
}

export type ReaderDownloadGlyphProps = {
  state: TranslationDownloadState | null
  tokens: ReaderTokens
}

// R29: the top bar's download button shows the progress in numbers. The
// button's own label says the same words, so this glyph stays silent.
export function ReaderDownloadGlyph({
  state,
  tokens,
}: ReaderDownloadGlyphProps) {
  const progress = downloadProgressText(state)
  if (progress !== null) {
    return (
      <Text
        accessible={false}
        importantForAccessibility="no"
        style={[styles.progress, { color: tokens.icon }]}
        numberOfLines={1}
        maxFontSizeMultiplier={READER_CHROME_MAX_FONT_SCALE}
      >
        {progress}
      </Text>
    )
  }
  return (
    <Ionicons name={downloadGlyphIcon(state)} size={22} color={tokens.icon} />
  )
}

const styles = StyleSheet.create({
  progress: {
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
})
