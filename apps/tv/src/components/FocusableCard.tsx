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
  accessibilityLabel?: string
  style?: ViewStyle
  children: ReactNode
}

export function FocusableCard({
  onPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  focusScale,
  accessibilityLabel,
  style,
  children,
}: FocusableCardProps) {
  const [isFocused, setIsFocused] = useState(false)
  const scale = useRef(new Animated.Value(1)).current
  const targetScale = focusScale ?? 1.05

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
    >
      <Animated.View
        needsOffscreenAlphaCompositing={Platform.OS === "android" && isFocused}
        renderToHardwareTextureAndroid={isFocused}
        style={[
          styles.outer,
          layoutStyle,
          isFocused && styles.focusGlow,
          { transform: [{ scale }] },
        ]}
      >
        <View
          style={[styles.inner, visualStyle, { flex: 1 }]}
          collapsable={false}
        >
          {children}
        </View>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: scaleSize(16),
    overflow: "visible",
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
})
