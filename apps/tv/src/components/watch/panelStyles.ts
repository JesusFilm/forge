// Shared StyleSheet tokens for the watch panels (Language / Subtitle on-page
// pickers + the in-player menu). Extracted so the variant-row visuals
// (row / disabledRow / rowInner / rowText / disabledText / unavailable / check)
// stay byte-identical across LanguagePanel, InPlayerMenu, and the shared
// VariantRow, instead of three drifting copies. SubtitlePanel reuses the row /
// rowInner / rowText / check tokens where it overlaps so the borderRadius and
// spacing stay consistent.
//
// Only the in-player menu uses a slightly tighter row padding (scale(16) vs the
// on-page panels' scale(18)) to fit more rows in the overlay; that single delta
// lives here as `rowInnerCompact` and is opted into via VariantRow's
// `rowInnerStyle` prop — every other token is shared verbatim.

import { StyleSheet } from "react-native"

import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"

export const panelStyles = StyleSheet.create({
  row: {
    backgroundColor: COLORS.surfaceContainerHigh,
    marginBottom: scale(12),
    borderRadius: scale(16),
  },
  disabledRow: {
    opacity: 0.4,
    overflow: "hidden",
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(18),
    paddingHorizontal: scale(24),
  },
  // In-player menu's tighter row padding (scale(16)) — opt in via VariantRow's
  // rowInnerStyle so the on-page panels keep scale(18). Behavior-preserving.
  rowInnerCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(16),
    paddingHorizontal: scale(24),
  },
  rowText: {
    flex: 1,
    fontFamily: "System",
    fontSize: Math.round(scale(22)),
    fontWeight: "600",
    color: COLORS.text,
    marginRight: scale(12),
  },
  disabledText: {
    color: COLORS.muted,
  },
  unavailable: {
    fontFamily: "System",
    fontSize: Math.round(scale(16)),
    fontWeight: "600",
    color: COLORS.muted,
  },
  check: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    color: COLORS.primary,
    fontWeight: "700",
  },
})
