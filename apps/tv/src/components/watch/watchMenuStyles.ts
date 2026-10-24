// Shared chrome for the Audio Language / Subtitles sheets so both stay
// byte-identical. Design px map 1:1 onto scale(); no expo-blur on TV, so the
// frosted panel is approximated with a near-opaque dark fill (per WATCH_THEME).

import { StyleSheet } from "react-native"

import { scale } from "../../lib/scale"
import {
  MENU_LIST_VISIBLE_ROWS,
  WATCH_OPTION_ROW_HEIGHT,
} from "./watchMenuLayout"
import { WATCH_THEME } from "./watchDetailTheme"

export const watchMenuStyles = StyleSheet.create({
  // Dimmed (not blacked-out) backdrop — design `.menu-scrim` is rgba(0,0,0,.45)
  // + blur(3px); a touch more opacity compensates for the missing blur.
  scrim: {
    flex: 1,
    backgroundColor: WATCH_THEME.scrim(0.55),
    alignItems: "center",
    justifyContent: "center",
  },
  // Design `.menu`: translucent dark, 24px radius, hairline border, deep shadow.
  // overflow hidden clips the row list when it exceeds maxHeight, else rows +
  // Close paint past the rounded panel edge.
  panel: {
    width: scale(600),
    maxHeight: scale(820),
    backgroundColor: "rgba(28,28,30,0.96)",
    borderRadius: scale(24),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: scale(14),
    overflow: "hidden",
    // Approximates `box-shadow: 0 40px 90px -24px rgba(0,0,0,.85)`.
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: scale(28) },
    shadowRadius: scale(45),
    shadowOpacity: 0.85,
  },
  // List capped by ITS OWN maxHeight (9 rows) so header + Close keep their space.
  // Panel maxHeight + flexShrink fails: Yoga won't shrink children against a
  // parent max-constraint, so the list pushes the footer out; own maxHeight is honored.
  list: {
    flexGrow: 0,
    maxHeight: MENU_LIST_VISIBLE_ROWS * WATCH_OPTION_ROW_HEIGHT,
  },
  // Design `.mhead` — padding 14/20/16, no per-item background.
  header: {
    paddingTop: scale(14),
    paddingHorizontal: scale(20),
    paddingBottom: scale(16),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    fontWeight: "700",
    color: WATCH_THEME.text,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "500",
    color: WATCH_THEME.text50,
    marginTop: scale(4),
  },
  listContent: {
    paddingBottom: scale(4),
  },
  // Non-focusable status rows (loading / error / empty) — aligned to the menu
  // item's horizontal inset so they read as part of the list.
  status: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "500",
    color: WATCH_THEME.text50,
    paddingVertical: scale(16),
    paddingHorizontal: scale(20),
  },
  // The dismiss affordance sits just below the scrolling list with a hair of
  // separation (the design dismisses via Back/scrim; we keep a focusable Close
  // so the viewer is never trapped in an empty/loading/error panel).
  footer: {
    marginTop: scale(6),
  },
})
