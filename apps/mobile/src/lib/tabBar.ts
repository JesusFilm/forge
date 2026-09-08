import { Platform, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BG_COLOR } from "./color"

export const TAB_BAR_PILL_HEIGHT = 56
export const TAB_BAR_PILL_LIFT = 12
export const TAB_BAR_PILL_SIDE_MARGIN = 16
export const TAB_BAR_PILL_RADIUS = TAB_BAR_PILL_HEIGHT / 2
export const TAB_BAR_CLEARANCE_GAP = 12

/**
 * Contrast floor for the labels, measured on the iPhone 17 Pro Max simulator
 * (2026-09-08) over a bright Home feed. Untinted, the worst ground read
 * rgb(86,74,77) and the idle labels 3.35:1, below the 4.5:1 AA threshold;
 * 0.26 is the computed minimum and 0.30 leaves margin (4.79:1).
 * Blur removes detail, not luminance — only a tint raises contrast.
 */
export const TAB_BAR_MATERIAL_TINT = "rgba(0, 0, 0, 0.3)"

/**
 * Space the bar occupies ABOVE the safe-area inset. The mini player reserves
 * this. Android keeps its present (already 7pt optimistic) value — correcting
 * it here would move the Android window and read as a regression.
 */
export const TAB_BAR_OCCUPIED_HEIGHT =
  Platform.select({
    ios: TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT,
    android: 56,
    default: 49,
  }) ?? 49

/** Android's bar, unchanged. The Library screen restores exactly this. */
export const TAB_BAR_FLAT_STYLE: ViewStyle = {
  backgroundColor: BG_COLOR,
  borderTopColor: "transparent",
}

/**
 * The navigator's `tabBarStyle`. A hook because the pill's lift is measured
 * from the safe area, and it reads `Platform.OS` at call time so a test can
 * reach both branches.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets()
  if (Platform.OS !== "ios") return TAB_BAR_FLAT_STYLE

  return {
    position: "absolute",
    height: TAB_BAR_PILL_HEIGHT,
    marginBottom: insets.bottom + TAB_BAR_PILL_LIFT,
    marginHorizontal:
      TAB_BAR_PILL_SIDE_MARGIN + Math.max(insets.left, insets.right),
    borderRadius: TAB_BAR_PILL_RADIUS,
    overflow: "hidden",
    // The bar puts `insets.bottom` INSIDE a numeric height, and it draws an
    // unconditional hairline. Both would eat the capsule.
    paddingBottom: 0,
    paddingHorizontal: 0,
    borderTopWidth: 0,
  }
}

/**
 * What a scroll surface must clear. Zero on Android, where the bar still
 * displaces content instead of floating over it.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets()
  if (Platform.OS !== "ios") return 0
  return (
    insets.bottom +
    TAB_BAR_PILL_HEIGHT +
    TAB_BAR_PILL_LIFT +
    TAB_BAR_CLEARANCE_GAP
  )
}
