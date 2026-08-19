import { useState } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons"

import {
  ACTION_ROW_PILL_GAP,
  DIVIDER_MARGIN_LEFT,
  DIVIDER_WIDTH,
  ICON_BUTTON_WIDTH,
  ICON_HIT_SLOP_MAX,
  ROW_PADDING_H,
  ROW_PADDING_LEFT,
  ROW_PADDING_RIGHT,
  actionRowSpacerWidths,
  iconInnerSlop,
} from "../../lib/actionRowSpacing"
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

/**
 * The icon + label inside a language/subtitle pill. Shared by the invisible
 * measurement probe and the real Pressable so the probe can never measure a
 * pill the user does not see.
 */
function PillContent({
  kind,
  label,
  color,
  textStyle,
}: {
  kind: "language" | "subtitle"
  label: string
  color: string
  textStyle: StyleProp<TextStyle>
}) {
  return (
    <>
      {kind === "language" ? (
        <Ionicons name="globe-outline" size={21} color={color} />
      ) : (
        <MaterialCommunityIcons
          name="closed-caption-outline"
          size={21}
          color={color}
        />
      )}
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
    </>
  )
}

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

  // Measured inputs for the spacing mode: the row's inner width plus each
  // pill's NATURAL width (the real pills clamp at the column, so only the
  // probe below can reveal how wide a name wants to be).
  const [rowInnerWidth, setRowInnerWidth] = useState<number | null>(null)
  const [langNatural, setLangNatural] = useState<number | null>(null)
  const [subNatural, setSubNatural] = useState<number | null>(null)
  const spacers = actionRowSpacerWidths({
    rowInnerWidth,
    langNatural,
    subNatural,
  })
  // Outer side keeps the full slop; the inner side yields to the neighbour so
  // the two 44pt-ideal touch rects never overlap at the compact floor.
  const inner = iconInnerSlop(spacers.betweenIcons)
  const downloadSlop = { left: ICON_HIT_SLOP_MAX, right: inner }
  const shareSlop = { left: inner, right: ICON_HIT_SLOP_MAX }

  const language = languageLabel?.trim() || "Language"
  const subtitle = subtitleLabel?.trim() || "Subtitles"
  // Subtitles read bright when on, muted when off (mirrors the "Off" label).
  const subColor = subtitleActive ? TEXT_PRIMARY : TEXT_SECONDARY
  const dl = downloadGlyphInfo(downloadState, downloadProgress)
  // The in-progress ring IS the control (mirrors the series button): pause while
  // transferring (tap→pause), play while paused (tap→resume/remove), neutral
  // download glyph while queued (no live transfer to pause yet).
  const inProgressIcon =
    downloadState === "paused"
      ? "play"
      : downloadState === "queued"
        ? "arrow-down"
        : "pause"
  const downloadA11y = !dl.inProgress
    ? dl.a11yLabel
    : downloadState === "paused"
      ? "Download paused. Tap to resume or remove"
      : downloadState === "queued"
        ? "Download queued. Tap to remove"
        : "Pause download"
  // The completed tick reads a touch larger than the idle/failed glyphs.
  const staticIconSize = downloadState === "downloaded" ? 28 : 24

  return (
    <View
      style={styles.row}
      onLayout={(e) =>
        setRowInnerWidth(e.nativeEvent.layout.width - ROW_PADDING_H)
      }
    >
      {/* Invisible probe: measures each pill's natural width with the same
          styles as the real pills, so the spacing mode sees how wide a name
          WANTS to be rather than the clamped width. */}
      <View
        style={styles.probe}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[styles.langRow, styles.probePill]}
          collapsable={false}
          onLayout={(e) => setLangNatural(e.nativeEvent.layout.width)}
        >
          <PillContent
            kind="language"
            label={language}
            color={TEXT_SECONDARY}
            textStyle={[styles.langText, typography.body]}
          />
        </View>
        <View
          style={[styles.langRow, styles.probePill]}
          collapsable={false}
          onLayout={(e) => setSubNatural(e.nativeEvent.layout.width)}
        >
          <PillContent
            kind="subtitle"
            label={subtitle}
            color={subColor}
            textStyle={[styles.langText, typography.body]}
          />
        </View>
      </View>

      {/* Audio + Subtitles flow as content-hugging pills, wrapping to a stacked
          layout only when the two names can't fit together. Tap opens the picker. */}
      <View style={styles.languages}>
        <Pressable
          onPress={onLanguage}
          style={({ pressed }) => [styles.langRow, pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Language, ${language}`}
        >
          <PillContent
            kind="language"
            label={language}
            color={TEXT_SECONDARY}
            textStyle={[
              styles.langText,
              typography.body,
              { color: TEXT_PRIMARY },
            ]}
          />
        </Pressable>
        <Pressable
          onPress={onSubtitles}
          style={({ pressed }) => [styles.langRow, pressed && feedback.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Subtitles, ${subtitle}`}
        >
          <PillContent
            kind="subtitle"
            label={subtitle}
            color={subColor}
            textStyle={[styles.langText, typography.body, { color: subColor }]}
          />
        </Pressable>
      </View>

      <View style={styles.divider} />

      {/* Download + Share: whitespace comes from the measured, SCALAR spacing
          model — the gaps shrink in proportion to how far the names outgrow
          the roomy column (actionRowSpacing). */}
      <View style={{ width: spacers.dividerIcon }} />
      <Pressable
        onPress={onDownload}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && feedback.pressed,
        ]}
        hitSlop={downloadSlop}
        accessibilityRole="button"
        accessibilityLabel={downloadA11y}
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
            <Ionicons name={inProgressIcon} size={12} color={dl.color} />
          </DownloadProgressRing>
        ) : (
          <Ionicons name={dl.icon} size={staticIconSize} color={dl.color} />
        )}
      </Pressable>
      <View style={{ width: spacers.betweenIcons }} />
      <Pressable
        onPress={onShare}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && feedback.pressed,
        ]}
        hitSlop={shareSlop}
        accessibilityRole="button"
        accessibilityLabel="Share"
      >
        <Ionicons name="share-outline" size={24} color={TEXT_SECONDARY} />
      </Pressable>
      <View style={{ width: spacers.iconEdge }} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: ROW_PADDING_LEFT,
    paddingRight: ROW_PADDING_RIGHT,
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
    columnGap: ACTION_ROW_PILL_GAP,
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
    width: DIVIDER_WIDTH,
    // Match the pill group's height whether it's one line or wrapped to two.
    alignSelf: "stretch",
    marginVertical: 4,
    marginLeft: DIVIDER_MARGIN_LEFT,
    backgroundColor: DIVIDER_COLOR,
  },
  probe: {
    position: "absolute",
    left: 0,
    top: 0,
    opacity: 0,
    // Column so each pill measures independently — side by side they would
    // squeeze each other before reporting.
    flexDirection: "column",
    alignItems: "flex-start",
  },
  probePill: {
    // Replace the real pill's percentage clamp so the probe hugs content.
    maxWidth: 10000,
  },
  iconButton: {
    // Visual width comes from the spacing model so the two cannot drift.
    width: ICON_BUTTON_WIDTH,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: ICON_BUTTON_WIDTH / 2,
  },
})
