import { useCallback, useEffect, useState } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from "react-native"

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

  // Tri-state: null until measured, so a short description never flashes a
  // toggle it does not need. The explicit `=== true` at the render site is for
  // readability against that tri-state — null and false are both falsy, so it
  // is not what hides the unmeasured state.
  const [overflows, setOverflows] = useState<boolean | null>(null)

  const handleToggle = useCallback(() => {
    animateLayout()
    setExpanded((prev) => !prev)
  }, [])

  // Re-measure when the text changes — a mounted instance can go partial ->
  // full under cache-first, and a stale `true` would keep a dead toggle up.
  useEffect(() => {
    setOverflows(null)
    setExpanded(false)
  }, [description])

  const handleMeasureLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      setOverflows(e.nativeEvent.lines.length > COLLAPSED_LINES)
    },
    [],
  )

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
