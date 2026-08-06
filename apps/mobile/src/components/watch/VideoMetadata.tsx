import { StyleSheet, Text, View } from "react-native"

import { TEXT_SECONDARY } from "../../lib/color"
import { displayLabel } from "../../lib/videoLabel"
import { text } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"

export interface VideoMetadataProps {
  label: string | null
  title: string | null
  subtitle: string | null
}

export function VideoMetadata({ label, title, subtitle }: VideoMetadataProps) {
  const typography = useTypography()

  if (title == null) return null

  return (
    <View style={styles.container}>
      {label != null && (
        <Text style={[styles.label, typography.caption]}>
          {displayLabel(label).toUpperCase()}
        </Text>
      )}
      <Text
        style={[text.sectionHeading, typography.titleLarge]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {subtitle != null && (
        <Text style={[text.sectionSubtitle, typography.bodySmall]}>
          {subtitle}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  label: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 4,
  },
})
