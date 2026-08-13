/**
 * Shared styles for mobile components. Convention: shared styles go FIRST in
 * style arrays, local overrides LAST — RN resolves left-to-right (last wins).
 */
import { StyleSheet } from "react-native"

import {
  ACCENT,
  ACCENT_ON_DARK,
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../lib/color"

// ── Spacing & sizing constants ─────────────────────────────────────────────

export const HORIZONTAL_PADDING = 16
export const CARD_GAP = 12
export const CARD_BORDER_RADIUS = 12

// Viewport-fraction detents for the language/subtitle formSheets. The unbounded
// formSheet root can't be measured, so list height derives from these + the
// detent-change index. Keep in sync with app/watch/_layout.tsx; index 0 is initial.
export const LIST_SHEET_DETENTS = [0.65, 1] as const

// ── Layout ─────────────────────────────────────────────────────────────────

export const layout = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  centered: {
    flex: 1,
    backgroundColor: BG_COLOR,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  sectionOuter: {
    marginVertical: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
})

// ── Text ───────────────────────────────────────────────────────────────────

export const text = StyleSheet.create({
  sectionHeading: {
    fontWeight: "700",
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  sectionHeadingPadded: {
    fontWeight: "700",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontWeight: "400",
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  errorTitle: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: "System",
    marginBottom: 8,
  },
  errorMessage: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontFamily: "System",
    textAlign: "center",
  },
  accentLinkText: {
    fontWeight: "600",
    // ACCENT_ON_DARK, not ACCENT: link text needs >= 4.5:1 on the dark bg (AA).
    color: ACCENT_ON_DARK,
    fontFamily: "System",
  },
  // Uppercase section eyebrow; padding/margins stay local to each consumer.
  eyebrow: {
    fontWeight: "600",
    color: TEXT_SECONDARY,
    fontFamily: "System",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
})

// ── Card ───────────────────────────────────────────────────────────────────

export const card = StyleSheet.create({
  base: {
    borderRadius: CARD_BORDER_RADIUS,
    overflow: "hidden",
  },
  surface: {
    borderRadius: CARD_BORDER_RADIUS,
    overflow: "hidden",
    backgroundColor: SURFACE_COLOR,
  },
  // Meta badge pinned to a poster card's top-right corner.
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "600",
  },
})

// ── Button ─────────────────────────────────────────────────────────────────

export const button = StyleSheet.create({
  accent: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  accentText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
  iconButton44: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
})

// ── Feedback ───────────────────────────────────────────────────────────────

export const feedback = StyleSheet.create({
  pressed: {
    opacity: 0.85,
  },
})

// ── Overlay ────────────────────────────────────────────────────────────────

export const overlay = StyleSheet.create({
  playOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
})

// ── Carousel ───────────────────────────────────────────────────────────────

export const carousel = StyleSheet.create({
  listContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  },
})
