import { type ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT_ON_DARK, BG_COLOR, TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import type { OfflineDownloadState } from "../../lib/offlineManifest"
import { DownloadProgressRing } from "./DownloadProgressRing"

// Green for a completed offline copy (the "downloaded" tick).
const DOWNLOADED_COLOR = "#34d399"
const FAILED_COLOR = "#fb7185"

export interface ActionButtonRowProps {
  onDownload: () => void
  onLanguage: () => void
  onSubtitles: () => void
  onShare: () => void
  /** Per-video offline state; drives the Download button's icon/label/color. */
  downloadState?: OfflineDownloadState | null
  /** Download progress (0..1) for the in-progress ring; null when unknown. */
  downloadProgress?: number | null
}

type ActionItem = {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  color: string
  onPress: () => void
  /** Replaces the plain icon (e.g. the progress ring) when present. */
  node?: ReactNode
}

const IN_PROGRESS_STATES: ReadonlySet<OfflineDownloadState> =
  new Set<OfflineDownloadState>(["downloading", "queued", "paused"])

/**
 * The Download button while a transfer is live: a circular progress ring around
 * a small glyph, labelled with the percentage so the user can see how much has
 * downloaded. Falls back to {@link downloadAction} for downloaded/failed/idle.
 */
function downloadingAction(
  state: OfflineDownloadState,
  progress: number | null | undefined,
  onPress: () => void,
): ActionItem {
  const pct =
    progress != null && progress > 0
      ? Math.min(100, Math.round(progress * 100))
      : null
  const label =
    state === "queued"
      ? "Queued"
      : state === "paused"
        ? "Paused"
        : pct != null
          ? `${pct}%`
          : "Downloading"
  const node = (
    <DownloadProgressRing
      size={28}
      strokeWidth={3}
      progress={progress ?? 0}
      color={ACCENT_ON_DARK}
      trackColor="rgba(255, 255, 255, 0.18)"
      cutoutColor={BG_COLOR}
    >
      <Ionicons
        name={state === "paused" ? "pause" : "arrow-down"}
        size={13}
        color={ACCENT_ON_DARK}
      />
    </DownloadProgressRing>
  )
  return {
    icon: "arrow-down-circle",
    label,
    color: ACCENT_ON_DARK,
    onPress,
    node,
  }
}

function downloadAction(
  state: OfflineDownloadState | null | undefined,
  onPress: () => void,
): ActionItem {
  switch (state) {
    case "downloaded":
      return {
        icon: "checkmark-circle",
        label: "Downloaded",
        color: DOWNLOADED_COLOR,
        onPress,
      }
    case "failed":
      return {
        icon: "alert-circle-outline",
        label: "Retry",
        color: FAILED_COLOR,
        onPress,
      }
    default:
      return {
        icon: "arrow-down-circle-outline",
        label: "Download",
        color: TEXT_SECONDARY,
        onPress,
      }
  }
}

export function ActionButtonRow({
  onDownload,
  onLanguage,
  onSubtitles,
  onShare,
  downloadState,
  downloadProgress,
}: ActionButtonRowProps) {
  const typography = useTypography()

  const downloadItem =
    downloadState && IN_PROGRESS_STATES.has(downloadState)
      ? downloadingAction(downloadState, downloadProgress, onDownload)
      : downloadAction(downloadState, onDownload)

  const actions: ActionItem[] = [
    downloadItem,
    {
      icon: "globe-outline",
      label: "Language",
      color: TEXT_SECONDARY,
      onPress: onLanguage,
    },
    {
      icon: "text-outline",
      label: "Subtitles",
      color: TEXT_SECONDARY,
      onPress: onSubtitles,
    },
    {
      icon: "share-outline",
      label: "Share",
      color: TEXT_SECONDARY,
      onPress: onShare,
    },
  ]

  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          {action.node ?? (
            <Ionicons name={action.icon} size={24} color={action.color} />
          )}
          <Text
            style={[
              styles.actionLabel,
              typography.caption,
              { color: action.color },
            ]}
          >
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
    justifyContent: "space-around",
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    marginTop: 4,
    paddingTop: 8,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    minHeight: 48,
    paddingVertical: 8,
  },
  actionLabel: {
    fontFamily: "System",
    marginTop: 4,
  },
})
