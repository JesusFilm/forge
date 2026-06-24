import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, SURFACE_COLOR, TEXT_SECONDARY } from "../../lib/color"
import { DOWNLOAD_DONE_COLOR } from "../../lib/downloadGlyph"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import { DownloadProgressRing } from "./DownloadProgressRing"
import {
  type SeriesDownloadState,
  seriesAllDownloaded,
  seriesDownloadLabel,
} from "../../lib/seriesDownloadAggregate"

// Language + Download all + Share. Download-all batches every episode through the
// per-video queue (U11). Separate from ActionButtonRow (a pill row + icon
// cluster) — different affordances.
export type SeriesActionRowProps = {
  onLanguage: () => void
  onDownload: () => void
  onShare: () => void
  /** Selected language name shown under the Language button. */
  languageLabel?: string | null
  /** Series-wide download progress shown under the Download button. */
  downloadState: SeriesDownloadState
}

type ActionItem = {
  /** Stable identity for the React key — label is dynamic (e.g. a language). */
  id: string
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
  /** Spoken label; falls back to the visible label when omitted. */
  accessibilityLabel?: string
}

export function SeriesActionRow({
  onLanguage,
  onDownload,
  onShare,
  languageLabel,
  downloadState,
}: SeriesActionRowProps) {
  const typography = useTypography()

  const language = languageLabel?.trim() || null
  const downloadLabel = seriesDownloadLabel(downloadState)
  const allDownloaded = seriesAllDownloaded(downloadState)

  const actions: ActionItem[] = [
    {
      id: "language",
      icon: "globe-outline",
      label: language ?? "Language",
      accessibilityLabel: language ? `Language, ${language}` : "Language",
      onPress: onLanguage,
    },
    {
      id: "download",
      icon: "arrow-down-circle-outline",
      label: downloadLabel,
      accessibilityLabel: downloadLabel,
      onPress: onDownload,
    },
    { id: "share", icon: "share-outline", label: "Share", onPress: onShare },
  ]

  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
        >
          {action.id === "download" && downloadState.inProgress ? (
            <DownloadProgressRing
              size={26}
              strokeWidth={2.5}
              progress={downloadState.progress}
              color={ACCENT}
              trackColor="rgba(255, 255, 255, 0.18)"
              cutoutColor={SURFACE_COLOR}
            >
              <Ionicons name={action.icon} size={12} color={ACCENT} />
            </DownloadProgressRing>
          ) : action.id === "download" && allDownloaded ? (
            // Green tick once every episode is saved — mirrors the per-video
            // Download button's "downloaded" glyph (checkmark-circle-outline).
            <Ionicons
              name="checkmark-circle-outline"
              size={24}
              color={DOWNLOAD_DONE_COLOR}
            />
          ) : (
            <Ionicons name={action.icon} size={24} color={TEXT_SECONDARY} />
          )}
          <Text style={[styles.actionLabel, typography.caption]}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    // Top-align so the icons stay on one line when a long language label wraps.
    alignItems: "flex-start",
    // Three items now (was 64 for two); tighten so the row fits a 320pt width.
    gap: 40,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    marginTop: 4,
    paddingTop: 8,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "flex-start",
    minWidth: 48,
    minHeight: 48,
    paddingVertical: 8,
  },
  actionLabel: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 4,
    // Bound the width so a long language name (e.g. "Arabic, Modern Standard")
    // wraps onto a second line instead of stretching the centered row.
    maxWidth: 200,
    textAlign: "center",
  },
})
