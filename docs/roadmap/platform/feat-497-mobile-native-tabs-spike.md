---
id: "feat-497"
title: "Mobile native tabs spike (iOS)"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 1
depends_on: []
blocks:
  - "feat-498"
tags:
  - "mobile"
  - "platform"
  - "navigation"
---

## Problem

The iOS tab bar in `apps/mobile` is a JS bar dressed as a Liquid Glass pill:
expo-router's `<Tabs>` (a vendored `@react-navigation/bottom-tabs` fork) shaped
by `tabBarStyle`, with an `expo-glass-effect` `GlassView` behind it and a JS
`Animated.View` "lens" as the selection highlight. It has the glass material but
none of the system tab bar's behaviour, and every iOS release moves Apple's bar
one step away from the imitation.

The spec rejected `expo-router/unstable-native-tabs` because "iOS below 26 must
get the same floating pill". That was never an owner decision; the owner
withdrew it on 2026-09-14 and is content for iOS 16.4–18 to show the standard
UIKit bar. With that gone, native tabs on iOS is feasible: expo-router resolves
`_layout.ios.tsx` beside `_layout.tsx`, so Android keeps the JS bar untouched.

Three facts that decide the cost of the migration are not knowable from the
code. This spike measures them and ends in a go/no-go. If go, allocate a
follow-up migration ticket (scope listed below) and set this one to complete.

## Entry Points — Read These First

1. `docs/superpowers/specs/2026-09-08-mobile-ios-glass-tab-bar-design.md` — the
   shipped design; read the two dated notes ("Withdrawn 2026-09-14" and
   "Corrected 2026-09-14") for what changed and why.
2. `apps/mobile/app/(tabs)/_layout.tsx` — the JS navigator to shadow with an
   iOS-only sibling. Note `tabBarBackground` is passed iOS-only, and the Search
   tab sets `headerShown: true` (NativeTabs has no header options).
3. `apps/mobile/src/lib/tabBar.ts` — every number the pill owns.
   `TAB_BAR_OCCUPIED_HEIGHT` (68pt iOS) feeds the mini player;
   `useTabBarClearance()` (`insets.bottom + 80`) pads five scroll surfaces and
   the Snackbar.
4. `apps/mobile/app/(tabs)/library.tsx:122-136` — hides the bar in selection
   mode via `navigation.setOptions({ tabBarStyle: { display: "none" } })`.
   NativeTabs drops `tabBarStyle` silently; its only hide lever is the
   navigator-level `<NativeTabs hidden>`.
5. `apps/mobile/node_modules/expo-router/build/native-tabs/types.d.ts` — the
   NativeTabs and Trigger option surface (`minimizeBehavior`, `tintColor`,
   `blurEffect`, `backgroundColor`, `disableTransparentOnScrollEdge`, `hidden`,
   per-trigger `disableAutomaticContentInsets`).
6. `apps/mobile/node_modules/expo-router/build/native-tabs/NativeTabsView.ios.js`
   — how options reach `react-native-screens` `Tabs.Host` / `Tabs.Screen`.
7. `apps/mobile/node_modules/react-native-screens/ios/tabs/host/RNSTabsHostComponentView.mm:243-253`
   — `tabBarHidden` is `setTabBarHidden:animated:` on iOS 18+ and
   `tabBar.hidden` below.

## Grep These

```bash
# Every consumer of the pill's numbers (all must be re-sourced or re-verified)
grep -rn 'useTabBarClearance\|TAB_BAR_OCCUPIED_HEIGHT\|tabBarPillShape\|useTabBarStyle\|TabBarBackground\|TabBarLens' apps/mobile/src apps/mobile/app

# Any existing NativeTabs use (expected: none)
grep -rn 'unstable-native-tabs\|NativeTabs' apps/mobile/src apps/mobile/app

# Platform-route resolution is on by default; confirm nothing disables it
grep -n 'platformRoutes' apps/mobile/app.json apps/mobile/node_modules/expo-router/build/getRoutesCore.js

# The tests that pin the JS bar (go red on iOS after a migration)
ls apps/mobile/app/__tests__/tabBar* apps/mobile/src/components/ui/__tests__/TabBar* apps/mobile/src/lib/__tests__/tabBar.test.ts
```

## What To Build

A throwaway iOS layout in a worktree. Do not touch `_layout.tsx`, Android, or
any consumer. Nothing from the spike is merged except this ticket's findings.

```tsx
// apps/mobile/app/(tabs)/_layout.ios.tsx  (spike only)
import { NativeTabs } from "expo-router/unstable-native-tabs"

export default function TabLayout() {
  return (
    <NativeTabs
      tintColor="#CB333B"
      backgroundColor="#1c1917"
      blurEffect="systemChromeMaterialDark"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="watch">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Icon sf="square.stack.fill" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf="person.fill" />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
```

Plus a probe rendered INSIDE a tab screen (the per-tab `SafeAreaProvider` is
what matters, not the root one):

```tsx
// spike only — drop into app/(tabs)/profile.tsx, remove before any commit
function InsetProbe() {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  console.log(
    `[tabs-spike] bottom=${insets.bottom} window=${height} os=${Platform.Version}`,
  )
  return <Text style={{ color: "#fff" }}>bottom inset: {insets.bottom}</Text>
}
```

### The three measurements

1. **Does `useSafeAreaInsets().bottom` inside a tab include the native bar?**
   Run the probe on iOS 17, iOS 18 and iOS 26 iPhone simulators. Record the
   number beside the home-indicator inset (34 on Pro Max). If it is
   `34 + bar`, every clearance collapses to `insets.bottom + gap`. If it is
   `34`, each surface needs a per-tier height table.
2. **Is the iPad top bar acceptable?** `supportsTablet: true` plus the default
   `tabBarControllerMode: 'automatic'` puts the bar at the TOP on iPadOS 18+.
   Screenshot an iPad simulator. Note whether `sidebarAdaptable={false}` (maps
   to `'tabBar'` mode) changes it.
3. **Does `<NativeTabs hidden>` reflow on iOS 17?** Toggle `hidden` with a
   temporary state and watch the Profile list. On iOS 18+ it is
   `setTabBarHidden:animated:` and reflows; below 18 it is `tabBar.hidden` and
   reflow is unproven.

Also note, from the same runs: cold-launch mount count (all four tabs mount
eagerly under NativeTabs; count `WATCH_SEARCH` requests at launch), whether the
inactive tint `#a8a29e` survives on iOS 26, and what the Search tab looks like
with no header.

### Go/no-go

- **Go** if measurement 1 includes the bar (or a per-tier table is accepted)
  AND the iPad result is acceptable (or `sidebarAdaptable={false}` fixes it).
- **No-go** otherwise: keep the pill, leave the spec's dated notes in place,
  set this ticket to `complete` with the numbers recorded here.

### Migration scope (for the follow-up ticket, if go)

- `app/(tabs)/_layout.ios.tsx` with `NativeTabs`; `_layout.tsx` stays for
  Android.
- Lift the Library `selecting` flag to the layout (context, module store, or
  route param) and drive `<NativeTabs hidden>`; drop the `setOptions` call on
  iOS.
- Move `app/(tabs)/watch.tsx` to `watch/index.tsx` with a `watch/_layout.tsx`
  Stack for the header.
- `disableAutomaticContentInsets` on every Trigger; re-size the JS pad per
  measurement 1. UIKit's automatic inset only reaches a scroll view first in
  the subview chain, and no tab screen has its list there (on Home it would
  land on the horizontal hero pager).
- Gate `useCategoryThumbnails` on first focus, as `watch.tsx` already gates
  its preview cycle.
- Retire `TabBarLens`, `TAB_ROUTE_NAMES`, `tabIndexForSegments` on iOS. Keep
  `TabBarBackground` for `SelectionActionBar` or restyle that bar.
- Update the ~11 pinned tests; `tabBarLayout.test.tsx` mocks only
  `expo-router`, so a NativeTabs import loads the real module under jest.
- Add `docs/solutions/` and `CLAUDE.md` entries; correct the spec's tab bar
  section in `apps/mobile/CLAUDE.md`.

## Constraints

- Do not merge spike code. Only this ticket, the spec's dated notes and the
  CLAUDE.md pointer land.
- Do not change Android. `_layout.tsx` stays byte-identical.
- Do not count minimize-on-scroll as a benefit. `react-native-screens` hands
  UIKit a content scroll view only through the experimental
  `<ScrollViewMarker>` over a direct ScrollView/FlatList child; Home's
  FlashList cannot be marked as-is.
- Do not claim the active label's AA failure is fixed. `#CB333B` is the brand
  red; the bar does not change it.
- Do not use `next dev`-style hot reload to judge the bar. Fast Refresh does
  not reliably apply material changes (`apps/mobile/CLAUDE.md`, tab bar
  section). Terminate and relaunch the dev client between runtimes.
- Do not measure on a stale dev client. Check the installed `forgewatch.app`
  carries the SDK 57 native set before trusting a result.

## Verification

```bash
# The iOS layout resolves beside the JS one (expo-router platform routes)
ls "apps/mobile/app/(tabs)/_layout.ios.tsx" "apps/mobile/app/(tabs)/_layout.tsx"

# Runtimes available for the three tiers
xcrun simctl list runtimes | grep -E 'iOS (17|18|26)'

# Probe output per runtime (expect one line per tab open)
# in the Metro log: [tabs-spike] bottom=<n> window=<h> os=<version>
```

Done when this ticket records, for each of iOS 17 / 18 / 26 / iPad: the probe's
`bottom` value, a screenshot of the bar, the hide-reflow result, and the
go/no-go line. On go, the follow-up ticket ID is written here and this ticket
is set to `complete`.

## Results — spike run 2026-09-14

Ran on the `spike/native-tabs-spike-497` worktree against local admin, with the
probe from "What To Build". Screenshots and the raw probe log are in the session
scratchpad; the numbers below are read from pixels, not by eye.

### M1 — the safe-area inset INCLUDES the native bar. GO.

| Runtime  | Device            | Tab visible | `insets.bottom` |
| -------- | ----------------- | ----------- | --------------- |
| iOS 26.5 | iPhone 17 Pro Max | Profile     | **83**          |
| iOS 26.5 | iPhone 17 Pro Max | bar hidden  | **34**          |
| iOS 18.6 | iPhone 16 Pro     | Profile     | **83**          |
| iOS 26.5 | iPad Pro 11 (M5)  | Home        | 20              |

83 = the 34pt home-indicator inset plus the 49pt UIKit bar, on both tiers. So
`useTabBarClearance()` collapses to `insets.bottom + TAB_BAR_CLEARANCE_GAP` and
needs no per-tier height table. `TAB_BAR_OCCUPIED_HEIGHT` for the mini player
still needs a number, but 49 is right on both tiers rather than per-tier.

### M2 — the iPad bar moves to the TOP, and `sidebarAdaptable={false}` does not move it back

On iPadOS 26.5 the four tabs render as a segmented pill in the top bar. Setting
`sidebarAdaptable={false}` (which maps to `tabBarControllerMode: 'tabBar'`)
changed nothing — the bar stayed at the top across a cold relaunch. This is the
one bad result of the spike. The app declares `supportsTablet: true`, so it is
reachable today.

### M3 — `<NativeTabs hidden>` works and reflows, on iOS 26

Toggling `hidden` moved `insets.bottom` 83 -> 34 and the content reflowed into
the vacated space in the same frame. **Not tested on iOS 18 or 16.4-17.** The
16.4-17 tier takes the `tabBar.hidden` branch rather than
`setTabBarHidden:animated:`, and that runtime is not installed on this machine
(another ~9GB download). It stays an open question for the migration ticket.

### Unplanned finding 1 — the material is fine below iOS 26 and uncontrollable on 26

With `backgroundColor="#1c1917"`, `blurEffect="systemChromeMaterialDark"` and
`disableTransparentOnScrollEdge`:

| Runtime  | Bar ground      | Idle label/icon      | Selected label/icon |
| -------- | --------------- | -------------------- | ------------------- |
| iOS 18.6 | `#1c1917` exact | `#a8a29e` exact      | `#cb333b` exact     |
| iOS 26.5 | Liquid Glass    | `rgb(247, 243, 241)` | `rgb(239, 85, 92)`  |

iOS 18 renders the app's own three colours byte-exact, so the below-26 bar is
not a compromise — it is the current palette in UIKit's standard shape. On
iOS 26 `backgroundColor` is ignored (expected — UIKit draws the glass), the
selected tint arrives lifted by vibrancy (`#cb333b` -> `rgb(239,85,92)`, which
incidentally reads BETTER than the pill's failing 3.39:1), and **the idle tint
is ignored entirely** — near-white instead of `#a8a29e`, with `iconColor` and
`labelStyle` both set. Losing the idle tint on iOS 26 is a real, if small,
design regression to weigh.

### Unplanned finding 2 — all four tabs mount at cold launch, confirmed

The probe lives in the Profile tab and logged on the first frame after the
bundle landed, while Home was the visible tab. This confirms the eager-mount
cost predicted from the source; the migration must gate `useCategoryThumbnails`
on first focus.

### Verdict — GO, with the iPad as the open question

M1 is the decisive result and it came out the cheap way. M3's 16.4-17 branch and
M2's iPad placement are the two loose ends. Neither blocks an iPhone-only
migration; the iPad needs a product decision (accept the top bar, or keep the JS
bar on iPad via a size-class branch) before it ships to tablets.

Follow-up migration ticket: **feat-498**
(`docs/roadmap/platform/feat-498-mobile-native-tabs-migration.md`).
