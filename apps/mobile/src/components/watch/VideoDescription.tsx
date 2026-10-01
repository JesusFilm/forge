import { useCallback } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { animateLayout } from "../ui/AnimatedChevron"
import { TEXT_BODY } from "../../lib/color"
import {
  useTextOverflow,
  type TextLayoutEvent,
} from "../../hooks/useTextOverflow"
import { useTypography } from "../../hooks/useTypography"
import { layout, text } from "../../styles/shared"

export interface VideoDescriptionProps {
  description: string | null
}

const COLLAPSED_LINES = 3

// Module scope, so the hook's measure handler keeps one identity.
function overflowsCollapsed(e: TextLayoutEvent): boolean {
  return e.nativeEvent.lines.length > COLLAPSED_LINES
}

export function VideoDescription({ description }: VideoDescriptionProps) {
  const typography = useTypography()

  // A mounted instance can go partial -> full under cache-first, so the hook
  // re-measures when the text changes.
  const { overflows, expanded, setExpanded, handleMeasureLayout } =
    useTextOverflow(description, overflowsCollapsed)

  const handleToggle = useCallback(() => {
    animateLayout()
    setExpanded((prev) => !prev)
  }, [setExpanded])

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
      {/* Hidden measuring copy. The visible Text carries numberOfLines, and RN
          then reports exactly that many lines whether the text was truncated
          or simply that long — so overflow has to be measured unconstrained. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={[styles.body, typography.body]}
          onTextLayout={handleMeasureLayout}
        >
          {description}
        </Text>
      </View>

      {overflows === true && (
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
  body: {
    color: TEXT_BODY,
    fontFamily: "System",
  },
  // Zero height + clipped: the Text still lays out at full width, so its line
  // count is real, but it takes up no space and paints nothing.
  measure: {
    height: 0,
    overflow: "hidden",
  },
  toggleButton: {
    marginTop: 4,
    minHeight: 44,
    justifyContent: "center",
  },
})
