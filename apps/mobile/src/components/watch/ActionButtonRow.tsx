import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import type { OfflineDownloadState } from "../../lib/offlineManifest"

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
}

type ActionItem = {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  color: string
  onPress: () => void
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
    case "downloading":
      return {
        icon: "arrow-down-circle",
        label: "Downloading",
        color: ACCENT,
        onPress,
      }
    case "queued":
      return { icon: "time-outline", label: "Queued", color: ACCENT, onPress }
    case "paused":
      return {
        icon: "pause-circle-outline",
        label: "Paused",
        color: ACCENT,
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
}: ActionButtonRowProps) {
  const typography = useTypography()

  const actions: ActionItem[] = [
    downloadAction(downloadState, onDownload),
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
          <Ionicons name={action.icon} size={24} color={action.color} />
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
