// Visual tokens (Claude Design handoff) now governing watch detail, Home, and
// Search. Deliberately diverges from app-wide Crimson Gallery (brighter accent,
// frosted-glass pills, white-fill focus, near-black scrims); SDUI/series/legacy
// keep Crimson Gallery (COLORS in lib/colors.ts). No expo-blur on TV, so "frosted
// glass" is a translucent white fill over the scrim — no real backdrop blur.

import { scale } from "../../lib/scale"

/** Near-black surface/ink shared by WATCH_THEME (focusInk) and SEARCH_THEME. */
export const NEAR_BLACK = "#0a0a0b"

export const WATCH_THEME = {
  /** Bright red CTA accent from the mockup (vs Crimson Gallery #CB333B). */
  accent: "#E1241E",
  accentText: "#ffffff",

  /** Glass secondary pills (resting). */
  pillGlass: "rgba(255,255,255,0.12)",

  /** Focused secondary pill: inverts to a white fill with dark text (tvOS HIG). */
  focusFill: "#ffffff",
  focusInk: NEAR_BLACK,

  /** Backdrop scrim base — near-black with a faint cool tint (rgba(7,7,8,a)). */
  scrim: (a: number) => `rgba(7,7,8,${a})`,
  /** Opaque background for the "below the fold" content section. */
  below: "#08080a",

  /** Text on the cinematic backdrop. */
  text: "#ffffff",
  text82: "rgba(255,255,255,0.82)",
  text74: "rgba(255,255,255,0.74)",
  text66: "rgba(255,255,255,0.66)",
  text62: "rgba(255,255,255,0.62)",
  text50: "rgba(255,255,255,0.5)",

  /** Translucent chip behind the kicker badge ("SERIES"). */
  badgeBg: "rgba(255,255,255,0.16)",
} as const

// ── Hero layout (shared by the watch + series detail screens) ──────
// Hero LAYOUT stops short of full height by HERO_PEEK so the next rail peeks above
// the fold (TV next-row-peek affordance; we deliberately ship no scroll chevron).
// HERO_BOTTOM_FADE_HEIGHT is the gradient fading the hero into the rail bg, killing the seam.
export const HERO_PEEK = scale(170)
export const HERO_BOTTOM_FADE_HEIGHT = scale(220)

// SECTION_HEADING moved to ../sections/sectionHeading (a generic SDUI section
// renderer must not depend on this watch-only token file).
