import { useCallback, useState } from "react"
import {
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  View,
} from "react-native"

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
  const [needsToggle, setNeedsToggle] = useState(false)

  if (description == null || description.length === 0) return null

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const handleTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (!expanded && e.nativeEvent.lines.length > COLLAPSED_LINES) {
        setNeedsToggle(true)
      }
    },
    [expanded],
  )

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      <Text
        style={[styles.body, typography.body]}
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        onTextLayout={handleTextLayout}
      >
        {description}
      </Text>
      {(needsToggle || expanded) && (
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
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  localHeading: {
    marginBottom: 8,
  },
  body: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  toggleButton: {
    marginTop: 8,
    minHeight: 48,
    justifyContent: "center",
  },
})
