import type { ReactNode } from "react"
import {
  Animated,
  StyleSheet,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { GlassView } from "expo-glass-effect"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { canUseLiquidGlass } from "../../lib/liquidGlass"
import { feedback } from "../../styles/shared"
import { PlatformBlur } from "./PlatformBlur"

/** The element's look today, drawn wherever Liquid Glass is unavailable. */
export type GlassFallback =
  /** `PlatformBlur` with these props: a blur on iOS, `androidDim` on Android. */
  | {
      kind: "blur"
      intensity?: number
      tint?: "dark" | "light" | "default"
      androidDim?: string
    }
  /** A plain view with this extra style, such as a fill and a shadow. */
  | { kind: "fill"; style: StyleProp<ViewStyle> }

export type GlassSurfaceProps = {
  /** Size, shape and inner layout, on both paths. Keep fills in `fallback`:
   *  a fill on the glass covers it. */
  style?: StyleProp<ViewStyle>
  fallback: GlassFallback
  /** Glass only: false dissolves the material to the `'none'` style. */
  visible?: boolean
  /** Glass only: the dissolve times in seconds. */
  dissolveSeconds?: { in: number; out: number }
  /** Glass only. */
  tintColor?: ColorValue
  /** On glass it fades one view around the children. In the fallback it fades
   *  the whole surface, so do not also fade an ancestor there. */
  fade?: Animated.WithAnimatedValue<number>
  /** A Pressable's pressed state: a scale on glass, today's dim elsewhere. */
  pressed?: boolean
  children?: ReactNode
}

// KTD5: the player glyphs fade out over 150 ms and back in over 100 ms.
const DEFAULT_DISSOLVE_SECONDS = { in: 0.1, out: 0.15 }

/**
 * One glass surface for every floating control (KTD2). On iOS 26 it draws
 * Liquid Glass; elsewhere it draws the caller's current look. Keep it out of
 * any layer whose opacity animates: GlassView draws nothing there.
 */
export function GlassSurface(props: GlassSurfaceProps) {
  return canUseLiquidGlass() ? (
    <LiquidGlassSurface {...props} />
  ) : (
    <FallbackSurface {...props} />
  )
}

function LiquidGlassSurface({
  style,
  visible = true,
  dissolveSeconds = DEFAULT_DISSOLVE_SECONDS,
  tintColor,
  fade,
  pressed = false,
  children,
}: GlassSurfaceProps) {
  const reduceMotion = useReduceMotion()
  return (
    // isInteractive stays unset: inside a Pressable it flashes white on remount.
    <GlassView
      style={[style, pressed && styles.pressedGlass]}
      glassEffectStyle={{
        style: visible ? "regular" : "none",
        animate: !reduceMotion,
        animationDuration: visible ? dissolveSeconds.in : dissolveSeconds.out,
      }}
      colorScheme="dark"
      tintColor={tintColor}
    >
      {fade == null ? (
        children
      ) : (
        <Animated.View style={{ opacity: fade }}>{children}</Animated.View>
      )}
    </GlassView>
  )
}

function FallbackSurface({
  style,
  fallback,
  fade,
  pressed = false,
  children,
}: GlassSurfaceProps) {
  const fadeStyle = fade == null ? null : { opacity: fade }
  const pressedStyle = pressed ? feedback.pressed : null

  if (fallback.kind === "fill") {
    return (
      <Animated.View style={[style, fallback.style, fadeStyle, pressedStyle]}>
        {children}
      </Animated.View>
    )
  }

  const blur = (
    <PlatformBlur
      style={[style, pressedStyle]}
      intensity={fallback.intensity}
      tint={fallback.tint}
      androidDim={fallback.androidDim}
    >
      {children}
    </PlatformBlur>
  )
  // PlatformBlur cannot take an animated style, so the fade wraps it.
  return fadeStyle == null ? (
    blur
  ) : (
    <Animated.View style={fadeStyle}>{blur}</Animated.View>
  )
}

const styles = StyleSheet.create({
  // FloatingBackButton's press: an opacity below 1 stops the glass drawing.
  pressedGlass: {
    transform: [{ scale: 0.92 }],
  },
})
