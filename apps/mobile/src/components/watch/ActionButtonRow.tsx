import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"

export interface ActionButtonRowProps {
  onDownload: () => void
  onLanguage: () => void
  onSubtitles: () => void
  onShare: () => void
}

type ActionItem = {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}

export function ActionButtonRow({
  onDownload,
  onLanguage,
  onSubtitles,
  onShare,
}: ActionButtonRowProps) {
  const typography = useTypography()

  const actions: ActionItem[] = [
    {
      icon: "arrow-down-circle-outline",
      label: "Download",
      onPress: onDownload,
    },
    { icon: "globe-outline", label: "Language", onPress: onLanguage },
    { icon: "text-outline", label: "Subtitles", onPress: onSubtitles },
    { icon: "share-outline", label: "Share", onPress: onShare },
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
          <Ionicons name={action.icon} size={24} color={TEXT_SECONDARY} />
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
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 4,
  },
})
