// Search-scoped tokens (Claude Design "Forge TV Home"). Like watchDetailTheme,
// deliberately diverges from Crimson Gallery (near-black, white-fill focus) and
// is scoped here — rest of the app keeps COLORS. Solid bg, not blur (no TV blur).

import { NEAR_BLACK } from "../watch/watchDetailTheme"

export const SEARCH_THEME = {
  /** Solid stand-in for the design's rgba(9,9,11,.62) blur-over-home layer. */
  bg: NEAR_BLACK,

  /** Full-strength text (typed query, focused card titles). */
  text: "#ffffff",
  /** White at an arbitrary alpha — the design speaks rgba(255,255,255,a). */
  textDim: (a: number) => `rgba(255,255,255,${a})`,

  /** Letter-strip key, resting. */
  keyBg: "rgba(255,255,255,0.07)",
  keyText: "rgba(255,255,255,0.78)",
  /** Letter-strip key, focused: inverts to white fill + near-black ink. */
  keyFocusBg: "#ffffff",
  keyFocusText: NEAR_BLACK,

  /** Thumb chip (episode count) backdrop. */
  chipBg: "rgba(0,0,0,0.6)",
  /** 1px resting outline on result thumbs. */
  thumbBorder: "rgba(255,255,255,0.07)",
  /** Focused-card ring (design: 0 0 0 5px rgba(255,255,255,.88)). */
  ring: "rgba(255,255,255,0.88)",
} as const

/**
 * Horizontal page gutter for the /search screen, in 1920-canvas units (pass
 * through scale()). The screen applies it as `paddingHorizontal`; SearchBrowse
 * cancels it with a negative margin to go full-bleed in the Apple TV stacked layout.
 */
export const SEARCH_PAGE_GUTTER = 80
