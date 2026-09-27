import { NativeTabs } from "expo-router/unstable-native-tabs"

import { READER_COPY } from "../../src/lib/bible/reader/copy"
import { ACCENT, BG_COLOR, TEXT_SECONDARY as MUTED } from "../../src/lib/color"
import { TAB_ROUTE_NAMES, type TabRouteName } from "../../src/lib/tabBar"
import { useTabBarHidden } from "../../src/lib/tabBarVisibility"

/**
 * One entry per tab, keyed by route name so the Record is exhaustive: adding a
 * file to `app/(tabs)/` without a tab here stops compiling.
 * `tabBarLensOrder.guard.test.js` pins TAB_ROUTE_NAMES against the route FILES,
 * and the trigger order below follows it.
 */
const TABS = {
  index: { label: "Home", sf: "house.fill" },
  watch: { label: "Search", sf: "magnifyingglass" },
  bible: { label: READER_COPY.tabTitle, sf: "book.closed.fill" },
  library: { label: "Library", sf: "square.stack.fill" },
  profile: { label: "Profile", sf: "person.fill" },
} as const satisfies Record<TabRouteName, { label: string; sf: string }>

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
          // UIKit's automatic inset only reaches a scroll view that is first in
          // the subview chain. No tab screen has one there — on Home it would
          // land on the horizontal hero pager — so the screens keep padding
          // themselves through `useTabBarClearance()`.
          disableAutomaticContentInsets
        >
          <NativeTabs.Trigger.Icon sf={TABS[name].sf} />
          <NativeTabs.Trigger.Label>
            {TABS[name].label}
          </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  )
}
