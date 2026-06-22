import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

import { BG_COLOR, TEXT_PRIMARY, TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import type { OfflineDownloadState } from "../../lib/offlineManifest"
import { downloadGlyphInfo } from "../../lib/downloadGlyph"
import { DownloadProgressRing } from "./DownloadProgressRing"

const DIVIDER_COLOR = "rgba(255, 255, 255, 0.12)"
// Subtle filled background so the Language/Subtitle rows read as tappable pills.
const CHIP_BG = "rgba(255, 255, 255, 0.07)"
// Full-radius pill sentinel; clamps to half the height so it stays a pill.
const PILL_RADIUS = 999

export interface ActionButtonRowProps {
  onDownload: () => void
  onLanguage: () => void
  onSubtitles: () => void
  onShare: () => void
  /** Per-video offline state; drives the Download icon/color. */
  downloadState?: OfflineDownloadState | null
  /** Download progress (0..1) for the in-progress ring; null when unknown. */
  downloadProgress?: number | null
  /** Selected dub language name shown on the Language row. */
  languageLabel?: string | null
  /** Selected subtitle name (or "Off") shown on the Subtitles row. */
  subtitleLabel?: string | null
  /** Subtitles on → bright row; off → muted, matching the "Off" state. */
  subtitleActive?: boolean
}

export function ActionButtonRow({
  onDownload,
  onLanguage,
  onSubtitles,
  onShare,
  downloadState,
  downloadProgress,
  languageLabel,
  subtitleLabel,
  subtitleActive,
}: ActionButtonRowProps) {
  const typography = useTypography()

  const language = languageLabel?.trim() || "Language"
  const subtitle = subtitleLabel?.trim() || "Subtitles"
  // Subtitles read bright when on, muted when off (mirrors the "Off" label).
  const subColor = subtitleActive ? TEXT_PRIMARY : TEXT_SECONDARY
  const dl = downloadGlyphInfo(downloadState, downloadProgress)

  return (
    <View style={styles.row}>
      {/* Audio + Subtitles flow as content-hugging pills, wrapping to a stacked
          layout only when the two names can't fit together. Tap opens the picker. */}
      <View style={styles.languages}>
        <Pressable
          onPress={onLanguage}
          style={({ pressed }) => [styles.langRow, pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Language, ${language}`}
        >
          <Ionicons name="globe-outline" size={21} color={TEXT_SECONDARY} />
          <Text
            style={[styles.langText, typography.body, { color: TEXT_PRIMARY }]}
            numberOfLines={1}
          >
            {language}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSubtitles}
          style={({ pressed }) => [styles.langRow, pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Subtitles, ${subtitle}`}
        >
          <MaterialCommunityIcons
            name="closed-caption-outline"
            size={21}
            color={subColor}
          />
          <Text
            style={[styles.langText, typography.body, { color: subColor }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </Pressable>
      </View>

      <View style={styles.divider} />

      {/* Download + Share are clean icons, grouped right. */}
      <View style={styles.icons}>
        <Pressable
          onPress={onDownload}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={dl.a11yLabel}
        >
          {dl.inProgress ? (
            <DownloadProgressRing
              size={26}
              strokeWidth={2.5}
              progress={downloadProgress ?? 0}
              color={dl.color}
              trackColor="rgba(255, 255, 255, 0.18)"
              cutoutColor={BG_COLOR}
            >
              <Ionicons name={dl.icon} size={12} color={dl.color} />
            </DownloadProgressRing>
          ) : (
            <Ionicons name={dl.icon} size={24} color={dl.color} />
          )}
        </Pressable>
        <Pressable
          onPress={onShare}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Share"
        >
          <Ionicons name="share-outline" size={24} color={TEXT_SECONDARY} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    marginTop: 4,
    paddingTop: 14,
    paddingBottom: 8,
  },
  languages: {
    flex: 1,
    minWidth: 0,
    // Pills flow on one line and only wrap to a stacked layout when the two
    // names can't fit together — no forced double-line gap for short names.
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: 10,
    columnGap: 8,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // Hug content, but never exceed the column — a very long name ellipsizes.
    maxWidth: "100%",
    minHeight: 38,
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: PILL_RADIUS,
    backgroundColor: CHIP_BG,
  },
  langText: {
    // Shrink + ellipsize only when the pill hits its max width.
    flexShrink: 1,
    minWidth: 0,
    fontFamily: "System",
  },
  divider: {
    width: 1,
    // Match the pill group's height whether it's one line or wrapped to two.
    alignSelf: "stretch",
    marginVertical: 4,
    backgroundColor: DIVIDER_COLOR,
  },
  icons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
})
