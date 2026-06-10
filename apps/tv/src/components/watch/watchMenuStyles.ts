// Shared chrome for the on-page Audio Language / Subtitles sheets, ported from
// the Claude Design handoff ("Forge TV Video Page" → `.menu` / `.menu-scrim` /
// `.mhead`). Both panels share this so the sheet container, header, and status
// rows stay byte-identical instead of drifting between two copies.
//
// Design → scale() is 1:1 for the watch-detail components (the action pills are
// already ported at this ratio: design `.btn-pill .cap` 23px == scale(23)), so
// the CSS px below map straight onto scale().
//
// No expo-blur on TV, so the design's translucent `backdrop-filter: blur(40px)`
// panel is approximated with a near-opaque dark fill over the dimmed backdrop —
// the same trade-off WATCH_THEME already documents for the frosted pills.

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
  // Design `.menu`: translucent dark, 24px radius, 1px hairline border, hugging
  // padding (14px), and a deep drop shadow. overflow hidden: the row list can
  // exceed maxHeight, and without clipping the overflowing rows paint past the
  // rounded panel edge (rows + Close rendering outside the dialog).
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
  // The scrolling row list is capped by ITS OWN maxHeight (exactly 9 rows) so
  // the header above and the Close footer below always keep their space inside
  // the panel. Capping via the panel's maxHeight + flexShrink does NOT work:
  // Yoga doesn't shrink children against a parent max-constraint, so the list
  // takes its full content height and pushes the footer out (clipped by the
  // panel's overflow hidden). A node's own maxHeight is always honored.
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
