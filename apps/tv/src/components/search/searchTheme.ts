// Visual tokens for the /search redesign, ported from the Claude Design
// handoff ("Forge TV Home" — .search-layer / .s-* / .card CSS blocks). Like
// watchDetailTheme.ts this deliberately diverges from the app-wide Crimson
// Gallery system (near-black surface, white-fill key focus, white card ring)
// and is SCOPED to the search components — Home and the rest of the TV app
// keep COLORS from lib/colors.ts.
//
// The design layers the search UI as a blur over home; as a standalone route
// we use a solid deep background instead (no backdrop blur on TV).

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
 * cancels it with an equal-and-opposite negative margin to go full-bleed in the
 * Apple TV stacked layout. Sharing the constant makes that cancellation a
 * compile-time guarantee instead of a "keep these in sync" comment.
 */
export const SEARCH_PAGE_GUTTER = 80
