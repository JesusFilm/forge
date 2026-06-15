// Visual tokens originally ported for the /watch/[slug] detail page from the
// Claude Design handoff ("Forge TV Video Page"), then adopted as the shared look
// for the Home and Search screens via the "Forge TV Home" redesign. WATCH_THEME
// now governs watch detail, Home, and Search — it deliberately diverges from the
// app-wide Crimson Gallery system (brighter red accent, frosted-glass pills,
// white-fill focus, near-black scrims). The SDUI experience renderer, series, and
// the remaining legacy surfaces keep their Crimson Gallery look (COLORS in
// lib/colors.ts).
//
// No expo-blur dependency on TV, so the "frosted glass" pills are approximated
// with a translucent white fill over the dark scrim — no actual backdrop blur.

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

// SECTION_HEADING moved to ../sections/sectionHeading (a generic SDUI section
// renderer must not depend on this watch-only token file).
