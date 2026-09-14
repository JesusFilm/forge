---
id: "feat-500"
title: "Mobile native tabs migration (iOS)"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 3
depends_on:
  - "feat-499"
blocks: []
tags:
  - "mobile"
  - "platform"
  - "navigation"
---

## Problem

iOS renders the bottom tab bar as a JS floating pill: expo-router's `<Tabs>`
shaped by `tabBarStyle`, with an `expo-glass-effect` `GlassView` behind it and a
JS `Animated.View` lens as the selection highlight. It carries the glass
material but none of the system bar's behaviour, and every iOS release moves
Apple's bar further from the imitation.

feat-499 measured the switch and returned GO. The decisive number: inside a
`NativeTabs` tab, `insets.bottom` reads **83** on both iOS 18.6 and iOS 26.5 —
the 34pt home-indicator inset plus the 49pt UIKit bar — so the clearance
collapses to `insets.bottom + gap` and needs no per-tier height table.

Move iOS to `expo-router/unstable-native-tabs`. Android keeps the JS bar
byte-identically.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-499-mobile-native-tabs-spike.md` — the
   measurements this plan rests on. Read the Results section first.
2. `apps/mobile/app/(tabs)/_layout.tsx` — the JS navigator. Stays, for Android.
   The iOS sibling shadows it; expo-router resolves `_layout.ios.tsx` by
   specificity and REQUIRES the extension-less fallback to exist.
3. `apps/mobile/src/lib/tabBar.ts` — every number. `TAB_BAR_OCCUPIED_HEIGHT`
   feeds the mini player; `useTabBarClearance()` pads five scroll surfaces plus
   the Snackbar.
4. `apps/mobile/app/(tabs)/library.tsx:121-136` — hides the bar in selection
   mode via `navigation.setOptions({ tabBarStyle: { display: "none" } })`, and
   restores it on blur and unmount. NativeTabs drops `tabBarStyle` SILENTLY.
5. `apps/mobile/app/(tabs)/_layout.tsx:43-56` — the Search tab's `Tabs.Screen`.
   It sets `headerShown: true` at line 47, plus the header title, the colours
   and `headerShadowVisible`. NativeTabs has no header options, so the screen
   (`apps/mobile/app/(tabs)/watch.tsx`) must draw that header itself.
6. `apps/mobile/src/components/library/SelectionActionBar.tsx:33-48` — borrows
   `tabBarPillShape` + `TabBarBackground`.
7. `apps/mobile/src/hooks/useCategoryThumbnails.ts:49-73` — fires six
   `WATCH_SEARCH` queries on mount. Under NativeTabs every tab mounts at cold
   launch, so this runs at launch instead of on first visit.

## Grep These

```bash
# Every consumer of the pill's numbers
grep -rn 'useTabBarClearance\|TAB_BAR_OCCUPIED_HEIGHT\|tabBarPillShape\|useTabBarStyle\|TabBarBackground\|TabBarLens\|TAB_ROUTE_NAMES\|tabIndexForSegments' apps/mobile/src apps/mobile/app

# The tests that pin the JS bar
ls apps/mobile/app/__tests__/tabBar*.test.* apps/mobile/src/components/ui/__tests__/TabBar*.test.tsx apps/mobile/src/lib/__tests__/tabBar.test.ts

# Platform-route resolution must stay on (no platformRoutes key = default true)
grep -n 'platformRoutes' apps/mobile/app.json
```

## What To Build

### 1. `app/(tabs)/_layout.ios.tsx` — the native navigator

`NativeTabs` with four `Trigger`s in the order `TAB_ROUTE_NAMES` declares, SF
Symbol icons, `tintColor` the brand accent, and `backgroundColor` +
`blurEffect="systemChromeMaterialDark"` + `disableTransparentOnScrollEdge` so
iOS 18 keeps the app's own ground. Set `disableAutomaticContentInsets` on every
Trigger — UIKit's auto-inset only reaches a scroll view first in the subview
chain, which no tab screen has, so leaving it on would silently inset the Home
hero pager instead.

`_layout.tsx` must stay on disk unchanged. expo-router throws
`does not have a fallback sibling file without a platform extension` otherwise.

### 2. Lift the Library selection flag to the layout

NativeTabs' only bar-hide lever is the navigator-level `hidden` prop, so
`selecting` must leave the screen. Add a module store (the repo's mini-player
precedent — `useSyncExternalStore`, not context: the layout and the screen are
in different trees). The screen sets it; `_layout.ios.tsx` reads it. Keep the
`setOptions` call for Android.

Release it on blur and unmount exactly as today, or a tab switch strands the bar
hidden.

### 3. Clearance and occupied height

- `useTabBarClearance()` on the native path returns `insets.bottom + GAP`.
  `insets.bottom` already carries the bar (83 = 34 + 49, measured on both
  tiers). Do NOT add a bar height on top of it.
- `tabBarOccupiedHeightFor("ios")` becomes **49**, the real UIKit bar. The mini
  player reads the ROOT safe-area provider, outside the tab controller, so it
  needs the explicit number; 68 leaves a 19pt gap.

### 4. The Search tab's header

Render it in-screen rather than nesting a Stack. The header is a flat dark bar
with a title and `headerShadowVisible: false`; reproducing it in the screen
costs a few lines and avoids moving an 899-line file into `watch/index.tsx`.

### 5. Retire the JS-only pieces on iOS

`TabBarLens` and `tabIndexForSegments` lose their only mount point
(`tabBarBackground` does not exist on NativeTabs). `TAB_ROUTE_NAMES` stays and
takes a new job: `_layout.ios.tsx` builds every `NativeTabs.Trigger` from it, and
`src/lib/tabBar.ts` names that file as its consumer. Add a `TabRouteName` export
beside it, so the icon and label map is an exhaustive `Record`.
`TabBarBackground` stays — `SelectionActionBar` still renders it. Give that bar
the flush geometry the native bar has rather than the pill's floating box.

### 6. Tests

Update the ~11 suites that pin the JS bar. The iOS-specific ones become
Android-only assertions plus new NativeTabs assertions. Keep
`tabBarClearance.guard.test.js` as the enumeration it is.

`tabBarLayout.test.tsx` mocks only `expo-router`, so a `NativeTabs` import loads
the REAL `unstable-native-tabs` module under jest — mock that path too.

## Constraints

- **Android must not change.** `_layout.tsx`, `TAB_BAR_FLAT_STYLE` and every
  Android padding value stay byte-identical. Prove it, do not argue it.
- **iPad ships with the bar at the TOP.** iPadOS 26 places a
  UITabBarController's bar at the top and `sidebarAdaptable={false}` does not
  move it (measured, feat-499 M2). Accepted for this ticket — it is the current
  iPadOS convention and the app is iPhone-first. A size-class branch that keeps
  the JS pill on iPad is a follow-up if the owner wants one.
- **Do not claim minimize-on-scroll.** react-native-screens feeds UIKit a
  content scroll view only through the experimental `<ScrollViewMarker>` over a
  direct ScrollView/FlatList child, and Home's FlashList cannot be marked.
- **Do not claim the active label's AA failure is fixed.** It is the brand red.
  (iOS 26 vibrancy lifts `#cb333b` to `rgb(239,85,92)`, which happens to read
  better, but that is UIKit's doing and is not a colour decision.)
- **The idle tint is lost on iOS 26.** `iconColor` and `labelStyle` are both
  ignored there — measured near-white instead of `#a8a29e`. iOS 18 honours them
  exactly. Do not spend effort trying to force it.
- **No native code, no new dependency.** `expo-router/unstable-native-tabs` and
  `react-native-screens` are both already installed, so this ships over the air.

## Verification

```bash
cd apps/mobile
npx tsc --noEmit -p .
pnpm test
npx eslint app src --ext .ts,.tsx
```

Simulator, both tiers (feat-499's recipe — the dev client's debug dylib carries
the `RNSTabBarController` classes, so no rebuild is needed):

- iOS 26.5 — glass bar renders; four tabs switch; Library selection hides the
  bar and the content reflows; the mini player sits correctly over the bar.
- iOS 18.6 — the bar's ground measures `#1c1917`, idle items `#a8a29e`,
  selected `#cb333b`.
- Android — render `_layout.tsx` under `Platform.OS = "android"` on this branch
  and on `main`, and compare serialised trees.

Done when the three checks above pass, both tiers are screenshotted, and the
Android comparison is byte-identical.

## Results — 2026-09-14

Built and verified on the `feat/mobile-native-tabs` worktree.

- **Checks** — `tsc --noEmit` clean, `eslint` clean, **201 suites / 3116 tests**
  green.
- **iOS 26.5 (iPhone 17 Pro Max)** — the Liquid Glass bar renders, all four tabs
  switch, the Search tab draws its own header, Library selection hides the bar
  and the content reflows, cancelling restores it, and the mini player rests
  clear of the bar.
- **iOS 18.6 (iPhone 16 Pro)** — the bar measures the app's own three colours
  byte-exact: ground `#1c1917` = rgb(28,25,23), idle `#a8a29e` =
  rgb(168,162,158), selected `#cb333b` = rgb(203,51,59).
- **Android** — proven, not argued. `SelectionActionBar` plus the shared style
  constants were rendered under `Platform.OS = "android"` on this branch and on
  the parent commit, serialised, and diffed: **identical**.
- **Launch work** — the six `WATCH_SEARCH` thumbnail queries no longer fire at
  cold launch; they wait for the Search tab to take focus.

### Carried forward

- **iPad ships with the bar at the top** (feat-499 M2), as this ticket's
  constraints accepted. A size-class branch that keeps a JS bar on iPad is the
  follow-up if the owner wants one. Measured on an iPad Pro 11 (M5, iPadOS 26.5)
  on 2026-09-14: because no bar sits at the bottom there, the mini player's
  bottom reservation becomes vestigial and it rests 81pt above the screen edge
  against a 12pt side gap. Nothing is covered or clipped, so this is cosmetic,
  but it is the concrete cost of `TAB_BAR_OCCUPIED_HEIGHT` being an iPhone
  constant. Fold it into the iPad follow-up rather than patching it here.
- **The idle tint is UIKit's on iOS 26** — `iconColor` and `labelStyle` are
  honoured on 18 and ignored on 26.
- **`<NativeTabs hidden>` is verified on iOS 26 only.** The 16.4–17 branch takes
  `tabBar.hidden` rather than `setTabBarHidden:animated:`; that runtime is not
  installed on this machine.
