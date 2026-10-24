import { type ReactNode } from "react"
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"

import Ionicons from "@expo/vector-icons/Ionicons"

import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { feedback, overlay } from "../../styles/shared"

// ── Types ───────────────────────────────────────────────────────────────────

export type ScrimVariant = "standard" | "subtle"
export type PlayOverlaySize = "large" | "small"

export interface PressableCardProps {
  onPress: () => void
  accessibilityLabel: string
  accessibilityHint?: string
  accessibilityRole?: AccessibilityRole
  /** Outer pressable box — margins, and for carousels the surface + sizing. */
  style?: StyleProp<ViewStyle>
  /** Inner clipping surface, when the card needs a box distinct from the outer. */
  surfaceStyle?: StyleProp<ViewStyle>
  /** Bottom layer (image or color fill), beneath the scrim and content. */
  background?: ReactNode
  scrim?: ScrimVariant
  playOverlay?: PlayOverlaySize
  children?: ReactNode
}

// ── Constants ───────────────────────────────────────────────────────────────
// One definition each so the SDUI card renderers can't drift again.

const RIPPLE_COLOR = "rgba(255, 255, 255, 0.2)"

// Bottom-up black scrim. `standard` holds full transparency until 40% down;
// `subtle` ramps evenly to a lighter floor.
const SCRIM_COLORS: Record<ScrimVariant, readonly [string, string]> = {
  standard: [hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.85)],
  subtle: [hexToRgba(BLACK, 0), hexToRgba(BLACK, 0.7)],
}
const SCRIM_LOCATIONS: Record<ScrimVariant, [number, number] | undefined> = {
  standard: [0.4, 1],
  subtle: undefined,
}

const PLAY_ICON_SIZE: Record<PlayOverlaySize, number> = { large: 22, small: 18 }

// ── Component ───────────────────────────────────────────────────────────────

export function PressableCard({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  style,
  surfaceStyle,
  background,
  scrim,
  playOverlay,
  children,
}: PressableCardProps) {
  const layers = (
    <>
      {background}
      {scrim != null && (
        <LinearGradient
          colors={SCRIM_COLORS[scrim]}
          locations={SCRIM_LOCATIONS[scrim]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {children}
      {playOverlay != null && <PlayOverlay size={playOverlay} />}
    </>
  )

  return (
    <Pressable
      style={({ pressed }) => [
        style,
        pressed && Platform.OS === "ios" && feedback.pressed,
      ]}
      android_ripple={{ color: RIPPLE_COLOR, foreground: true }}
      onPress={onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {surfaceStyle != null ? (
        <View style={surfaceStyle}>{layers}</View>
      ) : (
        layers
      )}
    </Pressable>
  )
}

function PlayOverlay({ size }: { size: PlayOverlaySize }) {
  const large = size === "large"
  return (
    <View style={overlay.playOverlay} pointerEvents="none">
      <View style={large ? styles.playCircleLarge : styles.playCircleSmall}>
        <Ionicons
          name="play"
          size={PLAY_ICON_SIZE[size]}
          color={TEXT_ON_OVERLAY}
          style={large ? styles.playIconLarge : styles.playIconSmall}
        />
      </View>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const PLAY_CIRCLE_BG = "rgba(0, 0, 0, 0.5)"

const styles = StyleSheet.create({
  playCircleLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PLAY_CIRCLE_BG,
    justifyContent: "center",
    alignItems: "center",
  },
  playCircleSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PLAY_CIRCLE_BG,
    justifyContent: "center",
    alignItems: "center",
  },
  playIconLarge: {
    marginLeft: 4,
  },
  playIconSmall: {
    marginLeft: 3,
  },
})
