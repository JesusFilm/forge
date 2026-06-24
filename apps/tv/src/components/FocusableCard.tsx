import { useMemo, useRef, useState, type ReactNode } from "react"
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native"

import { COLORS } from "../lib/colors"
import { scale as scaleSize } from "../lib/scale"

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
  /**
   * Focus highlight. "white" (default) = WATCH_THEME white ring (border + neutral
   * shadow) matching Home/ResultCard/HomeCard — the app-wide focus look. "crimson"
   * = legacy Crimson Gallery glow, opt-in only.
   */
  focusRing?: "crimson" | "white"
  accessibilityLabel?: string
  /** VoiceOver/TalkBack reads this after the label to describe what activating
   *  the card does (e.g. "Opens this experience"). Optional when the action is
   *  self-evident (single-letter keyboard cells). */
  accessibilityHint?: string
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
  focusRing = "white",
  accessibilityLabel,
  accessibilityHint,
  style,
  children,
}: FocusableCardProps) {
  const [isFocused, setIsFocused] = useState(false)
  const scale = useRef(new Animated.Value(1)).current
  const targetScale = focusScale ?? 1.05
  const whiteRing = focusRing === "white"

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

  const animateIn = () => {
    setIsFocused(true)
    Animated.spring(scale, {
      toValue: targetScale,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start()
  }

  const animateOut = () => {
    setIsFocused(false)
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start()
  }

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        animateIn()
        onFocus?.()
      }}
      onBlur={() => {
        animateOut()
        onBlur?.()
      }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
    >
      <Animated.View
        needsOffscreenAlphaCompositing={Platform.OS === "android" && isFocused}
        renderToHardwareTextureAndroid={isFocused}
        style={[
          styles.outer,
          layoutStyle,
          isFocused &&
            (whiteRing ? styles.focusShadowNeutral : styles.focusGlow),
          focusAnchor === "left" && styles.focusAnchorLeft,
          { transform: [{ scale }] },
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
        {whiteRing && isFocused ? (
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
  focusGlow: {
    shadowColor: COLORS.primary,
    shadowRadius: scaleSize(16),
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 0 },
  },
  // White-ring variant: a neutral dark drop shadow (no crimson) for depth,
  // paired with the white border overlay below — the WATCH_THEME focus look.
  focusShadowNeutral: {
    shadowColor: "#000000",
    shadowRadius: scaleSize(20),
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: scaleSize(12) },
    // Android TV renders shadows via elevation, not the iOS shadow* props
    // (matches ResultCard's focused thumb).
    elevation: 8,
  },
  // Inset white border hugging the card edge (design: 0 0 0 5px rgba white;
  // SEARCH_THEME.ring / ResultCard use 0.88 — matched here at 0.9). borderRadius
  // tracks styles.inner so the ring follows the rounded corners.
  whiteRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: scaleSize(16),
    // Match the established white ring width (ResultCard / HomeCard use 5).
    borderWidth: scaleSize(5),
    borderColor: "rgba(255,255,255,0.9)",
  },
})
