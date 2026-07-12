// Single source for the TV focus visual: one curve, one white ring, one shadow
// vocabulary. Consumers pick a role preset; per-site geometry stays local.

import type { ViewStyle } from "react-native"

import { scale } from "../../lib/scale"

export const FOCUS_DURATION_MS = 180
// The app's one focus curve (design handoff: .18s cubic-bezier ease-out).
export const FOCUS_EASING_BEZIER = [0.22, 0.61, 0.36, 1] as const

/** The app-wide white focus ring (CLAUDE.md: white ring is the default on all surfaces). */
export const FOCUS_RING_COLOR = "rgba(255,255,255,0.9)"
export const FOCUS_RING_WIDTH = scale(5)

export type FocusShadowSpec = {
  /** "neutral" = dark depth shadow; "accent" = colored glow on a filled CTA. */
  color: "neutral" | "accent"
  radius: number
  opacity: number
  offsetY: number
  /** Android draws shadows via elevation; 0 = ring-only on Android. */
  elevation: number
}

export type FocusVisualSpec = {
  magnify: number
  lift: number
  shadow: FocusShadowSpec
}

export type FocusVisualRole = "card" | "thumb" | "cta" | "tile" | "row"

const PRESETS: Record<FocusVisualRole, FocusVisualSpec> = {
  // Browse/SDUI cards (FocusableCard default): inset white ring + neutral drop.
  card: {
    magnify: 1.05,
    lift: 0,
    shadow: {
      color: "neutral",
      radius: scale(20),
      opacity: 0.6,
      offsetY: scale(12),
      elevation: 8,
    },
  },
  // Fixed-size thumb cards (HomeCard / EpisodeCard / ResultCard): lift + frame ring.
  thumb: {
    magnify: 1.06,
    lift: scale(8),
    shadow: {
      color: "neutral",
      radius: scale(25),
      opacity: 0.8,
      offsetY: scale(16),
      elevation: 0,
    },
  },
  // Primary CTA pills on an accent fill (retry, Play): white border + accent glow.
  cta: {
    magnify: 1.05,
    lift: 0,
    shadow: {
      color: "accent",
      radius: scale(20),
      opacity: 0.5,
      offsetY: 0,
      elevation: 8,
    },
  },
  // Large ambient tiles (mission QR): subtle grow, neutral drop.
  tile: {
    magnify: 1.02,
    lift: 0,
    shadow: {
      color: "neutral",
      radius: scale(22),
      opacity: 0.6,
      offsetY: scale(10),
      elevation: 0,
    },
  },
  // Full-width rows (related questions): ring only, no motion.
  row: {
    magnify: 1,
    lift: 0,
    shadow: {
      color: "neutral",
      radius: 0,
      opacity: 0,
      offsetY: 0,
      elevation: 0,
    },
  },
}

export function resolveFocusVisual(
  role: FocusVisualRole,
  overrides?: { magnify?: number; lift?: number },
): FocusVisualSpec {
  const preset = PRESETS[role]
  if (overrides?.magnify == null && overrides?.lift == null) return preset
  return {
    ...preset,
    magnify: overrides.magnify ?? preset.magnify,
    lift: overrides.lift ?? preset.lift,
  }
}

const NEUTRAL_SHADOW_COLOR = "#000000"

/** Style for the focused state's shadow; accentColor is required for "accent" specs. */
export function focusShadowStyle(
  shadow: FocusShadowSpec,
  accentColor?: string,
): ViewStyle {
  return {
    shadowColor:
      shadow.color === "accent" && accentColor != null
        ? accentColor
        : NEUTRAL_SHADOW_COLOR,
    shadowRadius: shadow.radius,
    shadowOpacity: shadow.opacity,
    shadowOffset: { width: 0, height: shadow.offsetY },
    ...(shadow.elevation > 0 ? { elevation: shadow.elevation } : {}),
  }
}
