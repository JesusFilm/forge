import type { ReactNode } from "react"
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"

import {
  READER_GLASS_SIZE,
  READER_TOUCH_TARGET,
} from "../../lib/bible/reader/chrome"
import type { ReaderTokens } from "../../lib/bible/theme/palettes"
import { PlatformBlur } from "../ui/PlatformBlur"

type ReaderGlassButtonProps = {
  tokens: ReaderTokens
  accessibilityLabel: string
  onPress: () => void
  /** A circle holds one glyph; a pill grows with its label. */
  shape?: "circle" | "pill"
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

// The app's glass button in the reader's scheme (KTD12, R8, R36). Keep it out
// of any layer whose opacity animates: GlassView draws nothing there.
export function ReaderGlassButton({
  tokens,
  accessibilityLabel,
  onPress,
  shape = "circle",
  disabled = false,
  style,
  children,
}: ReaderGlassButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[styles.target, style]}
    >
      {({ pressed }) => (
        <ReaderGlassSurface
          tokens={tokens}
          style={[
            shape === "pill" ? styles.pill : styles.circle,
            pressed && styles.pressed,
          ]}
        >
          {/* Dim the content, not the glass: GlassView ignores opacity. */}
          <View style={[styles.content, disabled && styles.disabled]}>
            {children}
          </View>
        </ReaderGlassSurface>
      )}
    </Pressable>
  )
}

type ReaderGlassSurfaceProps = {
  tokens: ReaderTokens
  style: StyleProp<ViewStyle>
  children: ReactNode
}

// Liquid Glass where iOS has it. Elsewhere the TabBarBackground branch: a
// blur on iOS or a flat fill on Android, in the reader's surface token.
export function ReaderGlassSurface({
  tokens,
  style,
  children,
}: ReaderGlassSurfaceProps) {
  if (Platform.OS !== "ios") {
    return (
      <View style={[style, { backgroundColor: tokens.buttonSurface }]}>
        {children}
      </View>
    )
  }
  // isGlassEffectAPIAvailable guards iOS 26 betas that crash without it.
  if (isLiquidGlassAvailable() && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        style={style}
        glassEffectStyle="regular"
        colorScheme={tokens.scheme}
      >
        {children}
      </GlassView>
    )
  }
  return (
    <PlatformBlur
      style={[style, { backgroundColor: tokens.buttonSurface }]}
      intensity={60}
      tint={tokens.scheme}
      androidDim={tokens.buttonSurface}
    >
      {children}
    </PlatformBlur>
  )
}

const styles = StyleSheet.create({
  target: {
    minWidth: READER_TOUCH_TARGET,
    minHeight: READER_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: READER_GLASS_SIZE,
    height: READER_GLASS_SIZE,
    borderRadius: READER_GLASS_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pill: {
    height: READER_GLASS_SIZE,
    borderRadius: READER_GLASS_SIZE / 2,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    transform: [{ scale: 0.94 }],
  },
  disabled: {
    opacity: 0.5,
  },
})
