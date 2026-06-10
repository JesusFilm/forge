// Visual tokens for the /watch/[slug] detail page, ported from the Claude Design
// handoff ("Forge TV Video Page"). The user chose to match that mockup exactly,
// which deliberately diverges from the app-wide Crimson Gallery system (brighter
// red accent, frosted-glass pills, white-fill focus, near-black scrims). These
// tokens are SCOPED to the watch-detail components so Home / Search / the rest of
// the TV app keep their Crimson Gallery look (COLORS in lib/colors.ts).
//
// No expo-blur dependency on TV, so the "frosted glass" pills are approximated
// with a translucent white fill over the dark scrim — no actual backdrop blur.

export const WATCH_THEME = {
  /** Bright red CTA accent from the mockup (vs Crimson Gallery #CB333B). */
  accent: "#E1241E",
  accentText: "#ffffff",

  /** Glass secondary pills (resting). */
  pillGlass: "rgba(255,255,255,0.12)",

  /** Focused secondary pill: inverts to a white fill with dark text (tvOS HIG). */
  focusFill: "#ffffff",
  focusInk: "#0a0a0b",

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

// SECTION_HEADING moved to ../sections/sectionHeading (a generic SDUI section
// renderer must not depend on this watch-only token file).
