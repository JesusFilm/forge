import { useCallback, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { animateLayout } from "../ui/AnimatedChevron"
import { TEXT_BODY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { layout, text } from "../../styles/shared"

export interface VideoDescriptionProps {
  description: string | null
}

const COLLAPSED_LINES = 3

export function VideoDescription({ description }: VideoDescriptionProps) {
  const typography = useTypography()
  const [expanded, setExpanded] = useState(false)

  const handleToggle = useCallback(() => {
    animateLayout()
    setExpanded((prev) => !prev)
  }, [])

  // Guard AFTER all hooks — a description that goes null -> non-null on a mounted
  // instance (the series screen republishes partial -> full under cache-first)
  // would otherwise change the hook count between renders and crash.
  if (description == null || description.length === 0) return null

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      <Text
        style={[styles.body, typography.body]}
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
      >
        {description}
      </Text>
      <Pressable
        onPress={handleToggle}
        style={styles.toggleButton}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Show less" : "Read more"}
      >
        <Text style={[text.accentLinkText, typography.bodySmall]}>
          {expanded ? "Show less" : "Read more"}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  body: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  toggleButton: {
    marginTop: 4,
    minHeight: 44,
    justifyContent: "center",
  },
})
