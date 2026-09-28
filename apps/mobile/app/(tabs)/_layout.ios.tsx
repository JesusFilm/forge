import { NativeTabs } from "expo-router/unstable-native-tabs"

import { ACCENT, BG_COLOR, TEXT_SECONDARY as MUTED } from "../../src/lib/color"
import { isExploreAvailable } from "../../src/lib/explore/availability"
import {
  TAB_LABELS,
  TAB_ROUTE_NAMES,
  type TabRouteName,
} from "../../src/lib/tabBar"
import { useTabBarHidden } from "../../src/lib/tabBarVisibility"

/**
 * One SF Symbol per tab. The Record is exhaustive, so a new tab without an icon
 * stops compiling. The labels live in TAB_LABELS, shared with the Android bar.
 */
const TAB_ICONS = {
  index: "house.fill",
  explore: "play.circle.fill",
  watch: "magnifyingglass",
  bible: "book.closed.fill",
  profile: "person.fill",
} as const satisfies Record<TabRouteName, string>

/**
 * iOS runs the real UITabBarController (feat-500). Android keeps the JS bar in
 * `_layout.tsx`, which MUST stay on disk: expo-router resolves this file by
 * platform specificity and throws without an extension-less fallback sibling.
 *
 * Two appearance notes, both measured rather than assumed:
 * - `backgroundColor` + `blurEffect` land exactly on iOS 18 and are ignored on
 *   iOS 26, where UIKit draws Liquid Glass instead.
 * - `iconColor` / `labelStyle` are likewise honoured on 18 and ignored on 26,
 *   so the idle tint there is UIKit's own near-white. Not worth fighting.
 */
export default function TabLayout() {
  const hidden = useTabBarHidden()

  return (
    <NativeTabs
      hidden={hidden}
      tintColor={ACCENT}
      backgroundColor={BG_COLOR}
      blurEffect="systemChromeMaterialDark"
      // Without this the bar goes transparent wherever content reaches its
      // bottom edge, which on iOS 18 shows the scroll content through it.
      disableTransparentOnScrollEdge
      iconColor={{ default: MUTED, selected: ACCENT }}
      labelStyle={{ default: { color: MUTED }, selected: { color: ACCENT } }}
    >
      {TAB_ROUTE_NAMES.map((name) => (
        <NativeTabs.Trigger
          key={name}
          name={name}
          // KTD16: hide the trigger, never drop it. The gate is fixed per
          // bundle, because a change to `hidden` remounts the whole navigator.
          hidden={name === "explore" && !isExploreAvailable()}
          // UIKit's automatic inset only reaches a scroll view that is first in
          // the subview chain. No tab screen has one there — on Home it would
          // land on the horizontal hero pager — so the screens keep padding
          // themselves through `useTabBarClearance()`.
          disableAutomaticContentInsets
        >
          <NativeTabs.Trigger.Icon sf={TAB_ICONS[name]} />
          <NativeTabs.Trigger.Label>
            {TAB_LABELS[name]}
          </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  )
}
