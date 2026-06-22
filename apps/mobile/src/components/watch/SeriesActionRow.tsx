import { Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { TEXT_SECONDARY } from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"

// The series action row is Language + Share only. A series has no single asset
// to download or caption, so the video page's Download/Subtitles actions don't
// carry over. It stays a separate component from ActionButtonRow (a pill row +
// icon cluster) because the two surfaces have genuinely different affordances.
export type SeriesActionRowProps = {
  onLanguage: () => void
  onShare: () => void
  /** Selected language name shown under the Language button. */
  languageLabel?: string | null
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
  onShare,
  languageLabel,
}: SeriesActionRowProps) {
  const typography = useTypography()

  const language = languageLabel?.trim() || null

  const actions: ActionItem[] = [
    {
      id: "language",
      icon: "globe-outline",
      label: language ?? "Language",
      accessibilityLabel: language ? `Language, ${language}` : "Language",
      onPress: onLanguage,
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
    // Top-align so the icons stay on one line when a long language label wraps.
    alignItems: "flex-start",
    gap: 64,
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
