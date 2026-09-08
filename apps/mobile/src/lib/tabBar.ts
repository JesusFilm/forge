import { useMemo } from "react"
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
 * The tab screens, in the order `app/(tabs)/_layout.tsx` declares them. The
 * sliding lens derives its position from this, so the two must not drift —
 * `tabBarLensOrder.guard.test.js` pins them together.
 */
export const TAB_ROUTE_NAMES = ["index", "watch", "library", "profile"] as const

/** Inset of the lens inside the capsule, per side. */
export const TAB_BAR_LENS_INSET = 6
export const TAB_BAR_LENS_HEIGHT = TAB_BAR_PILL_HEIGHT - TAB_BAR_LENS_INSET * 2
export const TAB_BAR_LENS_RADIUS = TAB_BAR_LENS_HEIGHT / 2
export const TAB_BAR_LENS_DURATION_MS = 260

/**
 * The lens is weighted to its RIM, not its fill. Measured on a flat background
 * by selecting a cell and then leaving it: the fill lifts the ground from
 * rgb(20,18,17) to rgb(35,33,32), costing the ACTIVE label 3.49:1 -> 3.11:1.
 * That label already failed AA at 3.39:1 (D2), so the fill stays low and the
 * rim carries the visibility instead.
 */
export const TAB_BAR_LENS_FILL = "rgba(255, 255, 255, 0.05)"
export const TAB_BAR_LENS_BORDER = "rgba(255, 255, 255, 0.38)"

/** The expo-router group the tab screens live in. */
export const TAB_GROUP_SEGMENT = "(tabs)"

/**
 * Which tab the lens should sit over, from expo-router's segments.
 *
 * The scan starts AFTER the group marker. `app/watch/[slug].tsx` is a sibling
 * of the group on the root stack, so a pushed video route emits the bare
 * segment `watch` — the same name the Discover tab has. Scanning the whole
 * array matched it and slid the lens to Discover on every video open.
 *
 * `null` means "not on a tab": the caller holds its current cell rather than
 * moving. Returning 0 there would be just as wrong, only towards Home.
 */
export function tabIndexForSegments(
  segments: readonly string[],
): number | null {
  const group = segments.indexOf(TAB_GROUP_SEGMENT)
  if (group < 0) return null

  for (let i = segments.length - 1; i > group; i--) {
    const found = TAB_ROUTE_NAMES.indexOf(
      segments[i] as (typeof TAB_ROUTE_NAMES)[number],
    )
    if (found >= 0) return found
  }
  // The group segment alone is the index route.
  return 0
}

/**
 * Space the bar occupies ABOVE the safe-area inset. The mini player reserves
 * this. Android keeps its present (already 7pt optimistic) value — correcting
 * it here would move the Android window and read as a regression.
 *
 * The constant resolves the platform once at import, which is correct at
 * runtime and unreachable from a test. The pure function beside it is how
 * both branches get pinned.
 */
export function tabBarOccupiedHeightFor(platform: string): number {
  if (platform === "ios") return TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT
  if (platform === "android") return 56
  return 49
}

export const TAB_BAR_OCCUPIED_HEIGHT = tabBarOccupiedHeightFor(Platform.OS)

/** Android's bar, unchanged. The Library screen restores exactly this. */
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
 * Where the capsule sits. The ONE place this formula lives — the navigator's
 * bar and the Library selection bar both compose it, so they cannot drift.
 */
export function tabBarPillShape(insets: TabBarInsets) {
  return {
    height: TAB_BAR_PILL_HEIGHT,
    marginBottom: insets.bottom + TAB_BAR_PILL_LIFT,
    marginHorizontal:
      TAB_BAR_PILL_SIDE_MARGIN + Math.max(insets.left, insets.right),
    borderRadius: TAB_BAR_PILL_RADIUS,
    overflow: "hidden" as const,
  }
}

/**
 * The navigator's `tabBarStyle`. A hook because the pill's lift is measured
 * from the safe area, and it reads `Platform.OS` at call time so a test can
 * reach both branches.
 *
 * Split in two on purpose: `tabBarStyleFor` is the pure computation both
 * platforms' tests exercise directly, and the hook is the memoized wrapper.
 * The Library screen holds the hook's result in two effect dependency arrays,
 * so a fresh object every render re-ran `setOptions` on every unrelated render.
 */
export function tabBarStyleFor(insets: TabBarInsets): ViewStyle {
  if (Platform.OS !== "ios") return TAB_BAR_FLAT_STYLE
  return {
    position: "absolute",
    ...tabBarPillShape(insets),
    // The bar puts `insets.bottom` INSIDE a numeric height, and it draws an
    // unconditional hairline. Both would eat the capsule.
    paddingBottom: 0,
    paddingHorizontal: 0,
    borderTopWidth: 0,
  }
}

export function useTabBarStyle(): ViewStyle {
  const { bottom, left, right } = useSafeAreaInsets()
  return useMemo(
    () => tabBarStyleFor({ bottom, left, right }),
    [bottom, left, right],
  )
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
