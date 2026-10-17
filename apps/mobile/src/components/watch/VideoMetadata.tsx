import { StyleSheet, Text, View } from "react-native"

import { useT } from "../../i18n/useT"
import { useTextDirection } from "../../i18n/textDirection"
import { TEXT_SECONDARY } from "../../lib/color"
import { displayLabel } from "../../lib/videoLabel"
import { text } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"

export interface VideoMetadataProps {
  label: string | null
  title: string | null
  /** The language of `title` (KTD13); null when it is not known. */
  titleLang?: string | null
  subtitle: string | null
}

export function VideoMetadata({
  label,
  title,
  titleLang,
  subtitle,
}: VideoMetadataProps) {
  const typography = useTypography()
  const tLabel = useT("VideoLabel")
  const direction = useTextDirection()

  if (title == null) return null
  const titleDirection = direction.text(titleLang)

  return (
    <View style={styles.container}>
      {label != null && (
        <Text style={[styles.label, typography.caption, direction.ui]}>
          {displayLabel(label, tLabel).toLocaleUpperCase(direction.uiTag)}
        </Text>
      )}
      <Text
        style={[
          text.sectionHeading,
          typography.titleLarge,
          titleDirection.style,
        ]}
        accessibilityRole="header"
        accessibilityLanguage={titleDirection.accessibilityLanguage}
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
    // Tight seam to the action row's hairline below (user request 2026-08-18).
    paddingBottom: 8,
  },
  label: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 4,
  },
})
