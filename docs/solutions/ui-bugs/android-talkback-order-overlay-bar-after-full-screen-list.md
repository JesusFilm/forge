---
title: "Android puts a floating overlay bar after a full-screen list in screen-reader order, because it sorts sibling views by position"
date: "2026-09-30"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "On Android, the accessibility tree put the My Watch More (menu) button last, after every page element and just before the tab bar"
  - "adb shell uiautomator dump listed More at node index 12, after Guest, Sign in, No Downloads Yet, and Browse videos"
  - "iOS VoiceOver (idb ui describe-all on the iPhone 17 simulator, iOS 26.5) listed More first, so the defect was Android-only"
  - "The dump showed the full-screen ScrollView [0,0][1080,2145] as child 1 and the overlay bar [0,0][1080,262] as child 2 of the screen root"
root_cause: "wrong_api"
resolution_type: "code_fix"
framework_version: "react-native 0.86.3 (Fabric), expo ~57.0.25; Android API 35 (Pixel 9a emulator, dev client)"
related_components:
  - "apps/mobile/src/components/profile/MyWatchScreen.tsx"
  - "apps/mobile/src/components/ui/ScreenTopBar.tsx"
  - "apps/mobile/src/components/profile/__tests__/MyWatchScreen.test.tsx"
tags:
  - "react-native"
  - "android"
  - "talkback"
  - "accessibility"
  - "reading-order"
  - "overlay"
  - "zindex"
  - "fabric"
---

# Android puts a floating overlay bar after a full-screen list in screen-reader order, because it sorts sibling views by position

## Problem

On Android, the floating "More" (☰) button on the My Watch tab came after the whole page in the accessibility order, not first. Android sorts sibling views by position, and the full-screen list tied with the overlay bar on both the left and top edges.

## Symptoms

- Device check, 2026-09-30: Android emulator Pixel 9a, API 35, dev client. `adb shell uiautomator dump` put "More" at node 12. It came after Guest, Sign in, "No Downloads Yet", and "Browse videos", and before the tab bar items.
- In the dump, the screen root `ViewGroup` held the `ScrollView` `[0,0][1080,2145]` as child 1 and the overlay `ViewGroup` `[0,0][1080,262]` as child 2.
- On iOS (iPhone 17 simulator, iOS 26.5), `idb ui describe-all` listed More first, then Account, then the rest. Only Android was wrong.
- This session read the tree with `uiautomator` only. It did not run TalkBack itself, so the order that TalkBack speaks is inferred from the node order.
- The screen renders a full-screen `ScrollView` (`apps/mobile/src/components/profile/MyWatchScreen.tsx:72`), then `<ScreenTopBar overlay trailingAction={menuAction} />` (`:122`). The overlay style is `position: "absolute"`, `top: 0`, `left: 0`, `right: 0`, `zIndex: 1` (`apps/mobile/src/components/ui/ScreenTopBar.tsx:131-138`). The ☰ `Pressable` takes its label from `trailingAction.accessibilityLabel` (`ScreenTopBar.tsx:106`).

## What Didn't Work

Source citations in this doc point outside the tracked tree. Paths that start with `react-native/` are in the installed package, `apps/mobile/node_modules/react-native/` (version 0.86.3). Paths that start with `android-34/` are in the Android SDK sources, `$ANDROID_HOME/sources/android-34/`.

**`experimental_accessibilityOrder` (rejected after a source check).** The prop exists on `View` (`react-native/Libraries/Components/View/ViewPropTypes.js:505-510`). But the native flag `enableAccessibilityOrder` defaults to `false`:

- Android: `react-native/ReactAndroid/src/main/java/com/facebook/react/internal/featureflags/ReactNativeFeatureFlagsDefaults.kt:46`.
- JS getter: `react-native/src/private/featureflags/ReactNativeFeatureFlags.js:251`.
- iOS gates: `react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:453` and `:1391`.

A grep of `apps/mobile/src`, `apps/mobile/app`, `apps/mobile/plugins`, and `apps/mobile/app.json` found no override of the flag. So in this app (React Native 0.86.3), the prop does nothing. Check the flag default again after a React Native upgrade. If a later version turns it on, the prop becomes a second option. The position rule below still holds.

**Move the bar before the `ScrollView` in JSX (rejected by reasoning, not tried on a device).** A source reading shows that JSX order does not decide the mount order here. Fabric sets `orderIndex_ = props.zIndex.value_or(0)` for any non-static view (`react-native/ReactCommon/react/renderer/components/view/ConcreteViewShadowNode.h:106-111`). Then it stable-sorts the children by `orderIndex` (`react-native/ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp:19-48`, called at `:192`). So the `zIndex: 1` bar mounts after its `zIndex: 0` siblings in all cases. If you also remove the `zIndex`, the later `ScrollView` sits above the bar and covers it. Also, the Android sort compares bounds first, so child order does not decide it anyway.

## Solution

Start the `ScrollView` below the status-bar inset, and take the inset out of the content padding. The fix is in PR #2466, unmerged as of this writing.

Before:

```tsx
<ScrollView
  contentContainerStyle={[
    styles.content,
    {
      paddingTop: insets.top + CONTENT_TOP_GAP,
      paddingBottom: CONTENT_BOTTOM_GAP + tabBarClearance,
    },
  ]}
```

After (`apps/mobile/src/components/profile/MyWatchScreen.tsx:70-80`):

```tsx
{/* Android sorts screen-reader order by position, and a list that also
    starts at y 0 is taller than the bar, so it would read before More. */}
<ScrollView
  style={{ marginTop: insets.top }}
  contentContainerStyle={[
    styles.content,
    {
      paddingTop: CONTENT_TOP_GAP,
      paddingBottom: CONTENT_BOTTOM_GAP + tabBarClearance,
    },
  ]}
```

`CONTENT_TOP_GAP` is `16` (`MyWatchScreen.tsx:21`). The header still starts at `insets.top + 16`, so the resting layout does not move.

## Why This Works

Android builds the accessibility child list from a sorted copy of the children. `addChildrenForAccessibility` calls `ChildListForAccessibility.obtain(this, true)` (`android-34/android/view/ViewGroup.java:2457`). It keeps each child that `includeForAccessibility()` accepts as its own node. Otherwise it adds that child's children at the child's sorted slot (`ViewGroup.java:2463-2466`).

After a detached-view check and a data-sensitive check, `includeForAccessibility()` accepts two kinds of view (`android-34/android/view/View.java:14866-14868`). One is a view that is important for accessibility. The other is any view, when the querying service asks for views that are not important. The dump shows the overlay `ViewGroup` as a node, which fits a service that asks for them. A service that does not ask gets the overlay's children at the overlay's slot. In both cases, the overlay's own bounds decide where "More" comes.

The sort uses `COMPARISON_STRATEGY_STRIPE`, with a `LOCATION` fallback on `IllegalArgumentException` (`ViewGroup.java:9044-9059`). `compareBoundsOfTree` (from `ViewGroup.java:9135`) compares in this sequence:

1. Stripe: a view that ends above the other starts sorts first; a view below sorts last (`:9137-9146`).
2. Left edge, for LTR (`:9149-9153`).
3. Top edge (`:9161-9164`).
4. Height, with the taller view first: `return -heightDiference` (`:9166-9169`).
5. Width, with the wider view first (`:9171-9174`).
6. A recursive comparison of child bounds, when all of the above tie (`:9176` onward).

These citations are the API 34 source. The device ran API 35, whose source this session did not read. The device result matches the API 34 rule.

Before the fix, the bar `[0,0][1080,262]` and the list `[0,0][1080,2145]` overlapped, so the stripe step did not separate them. They tied on left and on top. The list is taller, so it sorted first, and every node inside it came before the bar.

After the fix, the list bounds are `[0,136][1080,2145]` on the Pixel 9a. The views still overlap, and the left edges still tie. The top edges now differ (0 against 136), so the bar sorts first. The device dump put "More" at node 1. Node 0 was the dev client's floating "Tools" button, which exists in dev builds only.

Evidence that the layout did not move: an ffmpeg difference of two screenshots, cropped below the status bar, peaked at 8 of 255 (average 0.04). The iOS order stayed the same.

Side effects:

- Scrolled content now clips at the list's top edge (y = `insets.top`). Before, it passed under the bar's opaque status-bar backdrop (`ScreenTopBar.tsx:67-72`, `:140-146`). Both look the same. The backdrop is now redundant on this screen, but it does no harm.
- Touches still pass through the bar. The bar uses `pointerEvents` `"box-none"` when it is an overlay (`ScreenTopBar.tsx:57`, `:61`, `:73`). Per this session's device check, a drag that starts beside ☰ scrolls the page on both platforms. On iOS, a tap on the avatar inside the bar's band opens Account.

## Prevention

**Rule.** When an absolute overlay floats over a full-bleed list, do not let the two views tie on the top-left corner. Give the list a top edge below the overlay's top edge, with a `marginTop` or a `top` offset. Do not rely on JSX order, `zIndex`, or `experimental_accessibilityOrder` to set the Android read order.

**Unit test.** `apps/mobile/src/components/profile/__tests__/MyWatchScreen.test.tsx:250-272`, "floats the menu bar, so the header starts just under the safe area", pins the geometry:

```tsx
expect(
  Number(StyleSheet.flatten(page.props.style as ViewStyle).marginTop),
).toBe(mockInsets.top)
expect(Number(content.paddingTop)).toBe(16)
```

`mockInsets.top` is `59` (`MyWatchScreen.test.tsx:54`). The test failed once when `marginTop` was set to `0`, so it can go red. Limit: jest has no Android accessibility tree. The test pins the geometry that produces the order, not the order itself. Only a device dump proves the order.

**Device check.** Run this after any change to the layout of an overlay screen.

```sh
adb shell uiautomator dump /sdcard/x.xml && adb pull /sdcard/x.xml /tmp/x.xml
python3 - <<'EOF'
import xml.etree.ElementTree as ET
for n in ET.parse("/tmp/x.xml").iter("node"):
    label = n.get("content-desc") or n.get("text")
    if label or n.get("clickable") == "true":
        print(label, n.get("bounds"))
EOF
```

- The document order of the dump is the sorted accessibility order, because each node's children come from the sorted list above. The script is a minimal version, not the exact script from the session.
- Pass condition: "More" is the first app node. On a dev build, ignore the dev client's "Tools" node.
- iOS: run `idb ui describe-all --udid <udid>` and confirm the same order.

**Candidate sites (not verified on a device).** `MyWatchScreen.tsx:122` is the only `<ScreenTopBar overlay` user. The Home screen has the same shape in source ("Three-Layer Hero" in `CONCEPTS.md`). `HomeHeader` is absolute at `top: 0` with `zIndex: 10` (`apps/mobile/src/components/ui/HomeHeader.tsx:115-119`). It carries "Search" (`:46`) and "My Watch" (`:62`). The hero touch overlay is absolute at `top: 0` with `zIndex: 2` (`apps/mobile/src/components/home/HomeScreen.tsx:727-732`). The `FlashList` at `HomeScreen.tsx:579` has no top offset prop. If the feed also starts at y 0 and is taller, Search and My Watch can come after the whole feed. Confirm this with a dump before you change Home.

## Related Issues

- `docs/solutions/mobile/rn-view-accessible-required-for-accessibilityrole.md`: the other native-tree defect. There a control is missing from the iOS tree; here a control is present but in the wrong Android order. Its tree check names only `idb ui describe-all`; the `uiautomator` check above is the Android counterpart.
- `docs/solutions/ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`: the same absolute top-0 bar over a full-screen list, fixed for touch with `zIndex: 10`. It does not cover screen-reader order.
- `docs/solutions/ui-bugs/paged-hero-overlay-chrome-touch-architecture.md` and `docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md`: the Home overlay layers. They cover touch and layering, not screen-reader order.
- `docs/solutions/design-patterns/tv-sticky-header-nextfocus-asymmetry-bridge-20260619.md`: tvOS D-pad focus is also decided by geometry, not by JSX order.
- `docs/solutions/logic-errors/expo-router-navigate-to-tabs-from-root-stack-pushes-duplicate-navigator.md`: a different defect from the same PR, on the same screens.
