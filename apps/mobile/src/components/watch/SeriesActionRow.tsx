import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

import {
  ACCENT_ON_DARK,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../lib/color"
import { DOWNLOAD_DONE_COLOR } from "../../lib/downloadGlyph"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import { DownloadProgressRing } from "./DownloadProgressRing"
import {
  type SeriesDownloadState,
  seriesAllDownloaded,
  seriesDownloadLabel,
} from "../../lib/seriesDownloadAggregate"

const DIVIDER_COLOR = "rgba(255, 255, 255, 0.12)"
// Subtle filled background so the Language row reads as a tappable pill.
const CHIP_BG = "rgba(255, 255, 255, 0.07)"
// Full-radius pill sentinel; clamps to half the height so it stays a pill.
const PILL_RADIUS = 999

// Mirrors ActionButtonRow: Language + Subtitles pills, a divider, then a
// right-aligned icon cluster. The "Download all" icon carries series-wide state
// (idle download-outline → progress ring → green tick when every episode saved).
export type SeriesActionRowProps = {
  onLanguage: () => void
  onSubtitles: () => void
  onDownload: () => void
  onShare: () => void
  /** Selected language name shown in the Language pill. */
  languageLabel?: string | null
  /** Selected subtitle name (or "Off") shown in the Subtitles pill. */
  subtitleLabel?: string | null
  /** Subtitles on → bright pill; off → muted, matching the "Off" state. */
  subtitleActive?: boolean
  /** Series-wide download progress driving the Download icon/ring. */
  downloadState: SeriesDownloadState
}

export function SeriesActionRow({
  onLanguage,
  onSubtitles,
  onDownload,
  onShare,
  languageLabel,
  subtitleLabel,
  subtitleActive,
  downloadState,
}: SeriesActionRowProps) {
  const typography = useTypography()

  const language = languageLabel?.trim() || "Language"
  const subtitle = subtitleLabel?.trim() || "Subtitles"
  // Subtitles read bright when on, muted when off (mirrors the "Off" label).
  const subColor = subtitleActive ? TEXT_PRIMARY : TEXT_SECONDARY
  const allDownloaded = seriesAllDownloaded(downloadState)
  // The ring IS the control: it holds a pause glyph while downloading (tap →
  // pause) and a play glyph once paused (tap → resume/cancel sheet). Icon-only,
  // so the spoken label carries the action.
  const downloadA11y = downloadState.pausedAggregate
    ? "Downloads paused. Tap for resume or cancel options"
    : downloadState.inProgress
      ? "Pause downloads"
      : seriesDownloadLabel(downloadState)

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

      {/* Download all + Share are clean icons, grouped right. */}
      <View style={styles.icons}>
        <Pressable
          onPress={onDownload}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={downloadA11y}
        >
          {downloadState.inProgress ? (
            <DownloadProgressRing
              size={26}
              strokeWidth={2.5}
              progress={downloadState.progress}
              color={ACCENT_ON_DARK}
              trackColor="rgba(255, 255, 255, 0.18)"
              cutoutColor={SURFACE_COLOR}
            >
              <Ionicons
                name={downloadState.pausedAggregate ? "play" : "pause"}
                size={12}
                color={ACCENT_ON_DARK}
              />
            </DownloadProgressRing>
          ) : allDownloaded ? (
            <Ionicons
              name="checkmark-circle-outline"
              size={28}
              color={DOWNLOAD_DONE_COLOR}
            />
          ) : (
            <Ionicons
              name="download-outline"
              size={24}
              color={TEXT_SECONDARY}
            />
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
