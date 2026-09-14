import { Platform, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BG_COLOR } from "./color"

/**
 * The UIKit tab bar's own height on iPhone, excluding the safe-area inset.
 * Measured on the iPhone 17 Pro Max (iOS 26.5) and iPhone 16 Pro (iOS 18.6):
 * a tab screen reports `insets.bottom` 83 against a 34pt home indicator.
 */
export const TAB_BAR_HEIGHT_IOS = 49

/** Breathing room between the last row of content and the bar above it. */
export const TAB_BAR_CLEARANCE_GAP = 12

/**
 * Contrast floor for text over the frosted material, measured on the iPhone 17
 * Pro Max simulator (2026-09-08) over a bright Home feed. Untinted, the worst
 * ground read rgb(86,74,77) and idle labels 3.35:1, below the 4.5:1 AA
 * threshold; 0.26 is the computed minimum and 0.30 leaves margin (4.79:1).
 * Blur removes detail, not luminance — only a tint raises contrast.
 *
 * The navigator no longer uses this (iOS runs the real UIKit bar, which draws
 * its own material). `SelectionActionBar` does, and it stands in the same place
 * over the same content, so the floor still applies.
 */
export const TAB_BAR_MATERIAL_TINT = "rgba(0, 0, 0, 0.3)"

/**
 * The tab screens, in the order the navigator declares them.
 * `app/(tabs)/_layout.ios.tsx` builds its triggers from this and
 * `tabBarLensOrder.guard.test.js` pins it against the route FILES — expo-router
 * appends an undeclared `app/(tabs)/*` file as a fifth tab, which a scan of the
 * layout alone cannot see.
 */
export const TAB_ROUTE_NAMES = ["index", "watch", "library", "profile"] as const

export type TabRouteName = (typeof TAB_ROUTE_NAMES)[number]

/** The expo-router group the tab screens live in. */
export const TAB_GROUP_SEGMENT = "(tabs)"

/**
 * Is the viewer on a tab screen? Key off the GROUP marker, never a tab name —
 * `app/watch/[slug].tsx` is a root-stack sibling and emits the bare segment
 * `watch`, which is also the Discover tab's name.
 */
export function isTabGroupRoute(segments: readonly string[]): boolean {
  return segments.includes(TAB_GROUP_SEGMENT)
}

/**
 * Space the bar occupies ABOVE the safe-area inset. The mini player reserves
 * this. Android keeps its present (already 7pt optimistic) value — correcting
 * it here would move the Android window and read as a regression.
 *
 * iOS is the real UIKit tab bar (feat-500). The mini player cannot read the
 * per-tab safe-area inset that carries it — the player lives in the ROOT
 * provider, outside the tab controller — so the number is spelled here.
 *
 * The constant resolves the platform once at import, which is correct at
 * runtime and unreachable from a test. The pure function beside it is how
 * both branches get pinned.
 */
export function tabBarOccupiedHeightFor(platform: string): number {
  if (platform === "ios") return TAB_BAR_HEIGHT_IOS
  if (platform === "android") return 56
  return 49
}

export const TAB_BAR_OCCUPIED_HEIGHT = tabBarOccupiedHeightFor(Platform.OS)

/** Android's bar. The Library screen restores exactly this after selection. */
export const TAB_BAR_FLAT_STYLE: ViewStyle = {
  backgroundColor: BG_COLOR,
  borderTopColor: "transparent",
}

export type TabBarInsets = {
  bottom: number
  left: number
  right: number
}

/**
 * The navigator's `tabBarStyle`. Android only — iOS is shadowed by
 * `_layout.ios.tsx`, whose UIKit bar takes no style object. Kept as a named
 * export because `library.tsx` writes it back through `setOptions`.
 */
export function useTabBarStyle(): ViewStyle {
  return TAB_BAR_FLAT_STYLE
}

/**
 * What a scroll surface must clear. Zero on Android, where the bar displaces
 * content instead of drawing over it.
 *
 * On iOS the native bar is ALREADY inside `insets.bottom` — UIKit reports the
 * tab bar as part of a tab screen's safe area (measured 83 = 34pt home
 * indicator + 49pt bar, on iOS 18.6 and 26.5 alike). So the bar height must NOT
 * be added again here; only the breathing gap is ours.
 */
export function tabBarClearanceFor(insets: Pick<TabBarInsets, "bottom">) {
  if (Platform.OS !== "ios") return 0
  return insets.bottom + TAB_BAR_CLEARANCE_GAP
}

export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets()
  return tabBarClearanceFor(insets)
}
