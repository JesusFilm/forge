import type { ComponentProps } from "react"
import { View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { TranslationDownloadState } from "../../../lib/bible/repository/translationDownloads"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import { clamp } from "../../../lib/scrubber"
import { ReaderProgressRing } from "../ReaderProgressRing"

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

/** The share done, from 0 to 1, while a download runs; else null. */
export function downloadProgress(
  state: TranslationDownloadState | null,
): number | null {
  if (state?.kind !== "downloading") return null
  return clamp(state.percent / 100, 0, 1)
}

/** The watch page's ring size and line (ActionButtonRow). */
const RING_SIZE = 26
const RING_STROKE = 2.5

export type ReaderDownloadGlyphProps = {
  state: TranslationDownloadState | null
  tokens: ReaderTokens
}

// R29: a ring shows the progress, as the watch page's download button does
// (owner, 2026-09-28). A Bible download cannot pause, so the center is an X:
// a tap offers only to cancel. The button's label says the percent.
export function ReaderDownloadGlyph({
  state,
  tokens,
}: ReaderDownloadGlyphProps) {
  const progress = downloadProgress(state)
  if (progress !== null) {
    return (
      <View
        testID="reader-download-ring"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <ReaderProgressRing
          size={RING_SIZE}
          strokeWidth={RING_STROKE}
          progress={progress}
          color={tokens.icon}
          trackColor={tokens.progressTrack}
        >
          <Ionicons name="close" size={14} color={tokens.icon} />
        </ReaderProgressRing>
      </View>
    )
  }
  return (
    <Ionicons name={downloadGlyphIcon(state)} size={22} color={tokens.icon} />
  )
}
