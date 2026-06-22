import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"

// Language + Share only: a series has no single asset to download or caption,
// so the video page's Download/Subtitles don't carry over. Separate component
// because ActionButtonRow is a fixed four-button row.
export type SeriesActionRowProps = {
  onLanguage: () => void
  onShare: () => void
}

type ActionItem = {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
}

export function SeriesActionRow({ onLanguage, onShare }: SeriesActionRowProps) {
  const typography = useTypography()

  const actions: ActionItem[] = [
    { icon: "globe-outline", label: "Language", onPress: onLanguage },
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
    justifyContent: "center",
    gap: 64,
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
