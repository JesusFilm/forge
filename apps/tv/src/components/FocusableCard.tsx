import { useMemo, type ReactNode } from "react"
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native"

import { scale as scaleSize } from "../lib/scale"
import { FOCUS_RING_COLOR, FOCUS_RING_WIDTH } from "./focus/focusVisual"
import { useFocusVisual } from "./focus/useFocusVisual"

/** Properties that control size and position in the parent layout. */
const LAYOUT_KEYS = new Set<keyof ViewStyle>([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "alignSelf",
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "zIndex",
])

type FocusableCardProps = {
  onPress: () => void
  onFocus?: () => void
  onBlur?: () => void
  hasTVPreferredFocus?: boolean
  focusScale?: number
  /**
   * Where the focus scale grows from. "center" (default) scales symmetrically;
   * "left" pins the left edge (grows rightward only) so a rail's first card stays
   * flush with the inset instead of bleeding toward the screen edge.
   */
  focusAnchor?: "center" | "left"
  accessibilityLabel?: string
  /** VoiceOver/TalkBack reads this after the label to describe what activating
   *  the card does (e.g. "Opens this experience"). Optional when the action is
   *  self-evident (single-letter keyboard cells). */
  accessibilityHint?: string
  /** Overrides Datadog RUM's tap-action name (which defaults to the accessibility
   *  label). Set a generic value when the label carries user-typed text. */
  ddActionName?: string
  style?: ViewStyle
  children: ReactNode
}

export function FocusableCard({
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  focusScale,
  focusAnchor = "center",
  accessibilityLabel,
  accessibilityHint,
  ddActionName,
  style,
  children,
}: FocusableCardProps) {
  // Shared focus engine ("card" role): one curve, white ring + neutral shadow.
  const { focused, setFocused, transform, focusedShadow, androidFocusProps } =
    useFocusVisual("card", { magnify: focusScale })

  const { layoutStyle, visualStyle } = useMemo(() => {
    if (style == null) return { layoutStyle: undefined, visualStyle: undefined }
    const layout: Partial<ViewStyle> = {}
    const visual: Partial<ViewStyle> = {}
    for (const [key, value] of Object.entries(style)) {
      if (LAYOUT_KEYS.has(key as keyof ViewStyle)) {
        ;(layout as Record<string, unknown>)[key] = value
      } else {
        ;(visual as Record<string, unknown>)[key] = value
      }
    }
    return {
      layoutStyle: Object.keys(layout).length > 0 ? layout : undefined,
      visualStyle: Object.keys(visual).length > 0 ? visual : undefined,
    }
  }, [style])

  // The white ring must follow the card's OWN corner radius (e.g. a pill at
  // borderRadius 999), not a fixed 16 — otherwise a square-ish ring frames a
  // rounded card. Falls back to the default card radius.
  const cardRadius = visualStyle?.borderRadius
  const ringRadius = typeof cardRadius === "number" ? cardRadius : scaleSize(16)

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocus?.()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      // Non-typed prop spread (KeyButton's pattern) — Pressable's TS types
      // don't declare dd-action-name.
      {...(ddActionName ? { "dd-action-name": ddActionName } : {})}
    >
      <Animated.View
        {...androidFocusProps}
        style={[
          styles.outer,
          layoutStyle,
          focused && focusedShadow,
          focusAnchor === "left" && styles.focusAnchorLeft,
          { transform },
        ]}
      >
        <View
          style={[styles.inner, visualStyle, { flex: 1 }]}
          collapsable={false}
        >
          {children}
        </View>
        {/* White focus ring — inset border overlay on the non-clipping outer
            (matches ResultCard/HomeCard). Mounted only while focused; constant
            geometry means toggling it never reflows content underneath. */}
        {focused ? (
          <View
            style={[styles.whiteRing, { borderRadius: ringRadius }]}
            pointerEvents="none"
          />
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: scaleSize(16),
    overflow: "visible",
  },
  // Scale from the left edge instead of the center, so a focused card grows
  // rightward only — keeps a left-aligned rail's first card flush with its inset.
  focusAnchorLeft: {
    transformOrigin: "0% 50%",
  },
  inner: {
    borderRadius: scaleSize(16),
    overflow: "hidden",
  },
  // Inset white border hugging the card edge; borderRadius tracks styles.inner
  // so the ring follows the rounded corners.
  whiteRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: scaleSize(16),
    borderWidth: FOCUS_RING_WIDTH,
    borderColor: FOCUS_RING_COLOR,
  },
})
