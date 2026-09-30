---
title: 'router.navigate("/(tabs)") from a root-stack screen pushes a second tab navigator; use router.dismissTo to return to the existing one'
date: "2026-09-30"
category: "logic-errors"
module: "apps/mobile"
problem_type: "logic_error"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "After a tap on Browse videos in the empty Downloads screen, an iOS back-swipe returned to the emptied Downloads screen"
  - "On Android, the hardware back button returned to the emptied Downloads screen instead of leaving the app"
  - 'router.navigate("/(tabs)") from the root-stack /downloads route pushed a second (tabs) navigator instance on top of Downloads'
  - "The same shared LibraryEmptyState call only switched tabs when it rendered inside a tab page, so the defect showed only from the root-stack caller"
  - "The jest suite stayed green, because the mocked router records the navigate call but cannot show the stack that the call builds"
root_cause: "wrong_api"
resolution_type: "code_fix"
framework_version: "expo-router 57.0.23, expo 57.0.25, react-native 0.86.3"
related_components:
  - "apps/mobile/app/downloads.tsx"
  - "apps/mobile/app/_layout.tsx"
  - "apps/mobile/src/components/library/LibraryEmptyState.tsx"
  - "apps/mobile/src/components/library/LibraryDownloads.tsx"
  - "apps/mobile/app/__tests__/downloadsScreen.test.tsx"
  - "apps/mobile/CLAUDE.md"
tags:
  - "mobile"
  - "expo-router"
  - "navigation"
  - "dismissto"
  - "root-stack"
  - "tab-navigator"
  - "back-stack"
  - "android-back"
---

# `router.navigate("/(tabs)")` from a root-stack screen pushes a second tab navigator

## Problem

`apps/mobile/app/downloads.tsx` is a root-stack route. It is a sibling of the `(tabs)` group in the root `Stack` (`apps/mobile/app/_layout.tsx:381`, `:448-451`). `unstable_settings.initialRouteName` is `"(tabs)"` (`_layout.tsx:254-256`). The screen covers the tab bar. When the list is empty, the screen shows `LibraryEmptyState` with a "Browse videos" button.

The shared component called `router.navigate("/(tabs)")`. On the My Watch tab page, that call only switches tabs. On the root-stack Downloads screen, the same call pushed a second `(tabs)` navigator on top of Downloads. It did not go back to the existing one.

A code review found the defect before merge (ce-code-review run `20260929-160853-dc8e35c7`, finding #3, P2). The fix is in PR #2466, unmerged as of 2026-09-30.

## Symptoms

- After "Browse videos", an iOS back-swipe returns to the empty Downloads screen.
- After "Browse videos", the Android hardware back button returns to Downloads. It does not leave the app.
- Per the source trace in "Why This Works", the root stack becomes `[(tabs), downloads, (tabs)]`: two tab navigators, with Downloads between them.
- All unit tests pass. The mocked router records the `navigate("/(tabs)")` call, but it cannot show the stack that the call makes.

## What Didn't Work

Only one state existed before the fix: the shared default `router.navigate("/(tabs)")` in `LibraryEmptyState`. Nothing else was tried.

That default is correct on the tab page (`apps/mobile/src/components/profile/MyWatchScreen.tsx:116`). It is wrong on the root-stack Downloads screen, which reused the same component. The unit test pinned the call, not the result. `apps/mobile/src/components/library/__tests__/LibraryEmptyState.test.tsx:94-106` asserts `navigate("/(tabs)")` and zero `push`/`replace` calls, with the comment "KTD12: navigate, never push or replace."

The plan rule KTD12 (`docs/plans/2026-09-29-1134-feat-mobile-my-watch-tab-layout-plan.md:182`) says "Every navigation from My Watch uses `router.navigate`." That rule is correct for a call that starts on a tab page. It is the wrong rule for a return to the tabs from a root route.

## Solution

`LibraryEmptyState` gets an optional `onBrowse` prop. The default stays `router.navigate("/(tabs)")`, which is correct on the tab page. `LibraryDownloads` passes a handler that calls `router.dismissTo("/(tabs)")`.

Before (`apps/mobile/src/components/library/LibraryEmptyState.tsx`):

```tsx
<Pressable
  onPress={() => router.navigate("/(tabs)")}
```

After (`LibraryEmptyState.tsx:25-27`, `:54`):

```tsx
/** Replaces the default tab switch. A root-stack host must pop back to the
 *  tab navigator: navigate("/(tabs)") there pushes a second one. */
onBrowse?: () => void
// ...
onPress={() => (onBrowse ? onBrowse() : router.navigate("/(tabs)"))}
```

After (`apps/mobile/src/components/library/LibraryDownloads.tsx:228-230`, `:481`):

```tsx
// POP_TO the existing tab navigator; its new `screen: "index"` param selects
// Home. With no (tabs) below, dismissTo replaces this screen with one.
const handleBrowse = () => router.dismissTo("/(tabs)")
// ...
<LibraryEmptyState onBrowse={handleBrowse} />
```

A manual check on 2026-09-29 confirmed the fix:

- iOS 26.5 simulator, iPhone 17 Pro: a back-swipe after "Browse videos" does not return to Downloads. A cold deep link to `/downloads` still works.
- Android Pixel 9a emulator, API 35: hardware back after "Browse videos" exits to the launcher.

## Why This Works

All line numbers are for expo-router 57.0.23. Here, `<er>` is `node_modules/.pnpm/expo-router@57.0.23_*/node_modules/expo-router/build`. Expo Router 57 vendors React Navigation under `<er>/react-navigation/`.

Why `navigate` pushes from a root route:

1. `router.navigate` and `router.dismissTo` both call `linkTo`. They differ only in the event, `NAVIGATE` or `POP_TO` (`<er>/global-state/router.js:58-60`, `:77-79`).
2. `getNavigateAction` finds the deepest navigator where the target state and the current state diverge (`<er>/global-state/getNavigationAction.js:45`, `<er>/global-state/stateUtils.js:49-79`). On Downloads, the focused root route is `downloads` and the target root route is `(tabs)`. The names differ at the root, so the action targets the root stack.
3. The payload holds `name`, `params`, and `singular` only (`getNavigationAction.js:89-98`). It never sets `pop`. For `"/(tabs)"`, `name` is `"(tabs)"` and `params` is `{ screen: "index", ... }` (`stateUtils.js:10-30`).
4. Expo Router's stack override handles `NAVIGATE` (`<er>/layouts/StackClient.js:82-105`). With no `getId`, it reuses a route only when that route is the CURRENT route (`:96-101`). It searches lower routes only when `payload.pop` is set (`:102-103`). `(tabs)` is below Downloads, so the override appends a new route with a new key (`:204-213`).
5. The `(tabs)` screen (`_layout.tsx:381`) sets no `getId` or `dangerouslySingular`, so no id match finds the old route (`<er>/useScreens.js:92-112`).

The same code explains why `navigate` is correct on a tab page. From My Watch, the focused root route is `(tabs)`, so the divergence search goes into the tab navigator. The action then only switches tabs. The current-route check at `StackClient.js:96-101` also makes a fast double tap open one root route, not two. That is the reason for KTD12.

Why `dismissTo` pops:

1. The stack override does not handle `POP_TO` (`StackClient.js:19-26`, `:57-58`). The vendored `StackRouter` handles it (`<er>/react-navigation/routers/StackRouter.js:336-402`).
2. `POP_TO` searches from the current index down to index 0 for a route with the target name (`:356-362`). It finds the existing `(tabs)` route and removes every route above it (`:394-401`). Downloads leaves the stack.
3. The `(tabs)` route gets the new params `{ screen: "index" }`. The tab navigator reads a changed `params.screen` and navigates to that tab (`<er>/react-navigation/core/useNavigationBuilder.js:415-434`). The user lands on Home.
4. If no route has the target name, `POP_TO` replaces the current route with a new one (`StackRouter.js:364-378`). Downloads does not stay under the new tab navigator.

On a cold deep link, the linking fork puts the initial route under the deep-linked screen (`<er>/fork/getStateFromPath.js:469-491`). `apps/mobile/src/lib/deepLinkOrigin.ts:3-6` records the same fact: "the initialRouteName anchor puts (tabs) under a cold link". So `/downloads` usually opens with `(tabs)` below it. `dismissTo` is correct in both cases.

## Prevention

**Rule.** A root-stack route sits OVER the tab navigator. To return to a tab from that route, use `router.dismissTo("/(tabs)/<tab>")` or `router.back()`. Do not use `router.navigate`, `router.push`, or `router.replace` with a `(tabs)` href there. On a tab page, `router.navigate` with a `(tabs)` href is correct, because it only switches tabs.

**Scope the "navigate, never push" rule.** KTD12, and the recommendations-row rule in `apps/mobile/CLAUDE.md:903-904`, apply to a call that starts on a tab page or opens a root route. They do not apply to a return to the tabs from a root route. When a shared component navigates, check every host route. Give a root-stack host an override prop, as `onBrowse` does.

**Test at the host, not only at the component.** The pin is in `apps/mobile/app/__tests__/downloadsScreen.test.tsx:482-496`:

```tsx
await press(pressableByLabel(renderer, "Browse videos"))

expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1)
expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
expect(mockRouter.push).toHaveBeenCalledTimes(0)
expect(mockRouter.replace).toHaveBeenCalledTimes(0)
```

`LibraryEmptyState.test.tsx:108-119` ("runs the host's onBrowse in place of the default navigate") pins that the prop replaces the default. A mocked router proves the call, not the stack. Only a device check proves the stack. After the return, an iOS back-swipe must not show the root route again. On Android, hardware back on Home must exit to the launcher.

**Audit other call sites.** Run this grep:

```bash
grep -rnE "\(tabs\)" apps/mobile/app apps/mobile/src --include='*.ts' --include='*.tsx' | grep -v __tests__
```

A group segment is not part of the URL, so a bare tab path such as `"/profile"` also targets `(tabs)`. Search for those paths too. The current tree has these `(tabs)` call sites. This learning changed none of them.

| Call site                                                                                    | Call                                                       | Hosts                                                                                                                                                                                                                                      | Exposure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/components/ui/ScreenTopBar.tsx:40-43` (`leaveToMyWatch`, added in PR #2466) | `canGoBack() ? back() : navigate("/(tabs)/profile")`       | The top-bar back handler (`:55`, pressed at `:76`) on Downloads, More, and Account (`LibraryDownloads.tsx:349`, `apps/mobile/app/more.tsx:39`, `apps/mobile/app/account.tsx:132`). The sign-out leave in `apps/mobile/app/account.tsx:48`. | Same class, narrower. `back()` pops the root route, which is safe. The `navigate` branch runs only when `canGoBack()` is false (`<er>/global-state/router.js:96-109`), so the root route is alone. Then `NAVIGATE` pushes `(tabs)` over it (`StackClient.js:204-213`), and a back gesture returns to that route. The cold-link anchor makes this branch rare. A candidate change is `router.dismissTo("/(tabs)/profile")`, which replaces the lone route (`StackRouter.js:364-378`). Not verified on a device. |
| `apps/mobile/src/contexts/LapseReminderProvider.tsx:93`                                      | `router.replace("/(tabs)")` on a "home" reminder tap       | The route in focus when the tap arrives                                                                                                                                                                                                    | Candidate defect, from the source trace only. From a root-stack route over `(tabs)`, `REPLACE` swaps the top route for a NEW `(tabs)` route (`StackRouter.js:154-176`). The old `(tabs)` stays below, so the stack holds two tab navigators. A candidate change is `router.dismissTo("/(tabs)")`. Not verified on a device.                                                                                                                                                                                    |
| `apps/mobile/src/components/ui/FloatingBackButton.tsx:36-37`                                 | `canGoBack() ? back() : replace("/(tabs)")`                | `apps/mobile/app/experience/[slug].tsx`, `apps/mobile/app/mission.tsx`, `apps/mobile/app/series/[slug].tsx`, `apps/mobile/app/watch/[slug].tsx`, `PlaybackHost`                                                                            | Safe. `replace` runs only when the root route is alone, so the result is `[(tabs)]`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/mobile/src/components/ui/HomeHeader.tsx:47`, `:63`                                     | `navigate("/(tabs)/watch")`, `navigate("/(tabs)/profile")` | `HomeScreen` on the Home tab. `apps/mobile/app/experience/[slug].tsx:41` renders `CuratedHomeLayout` with `hideHeader`, so `HomeHeader` does not render on that root route.                                                                | Safe today. The exposure returns if a root-stack screen renders `HomeHeader`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/mobile/src/components/library/LibraryEmptyState.tsx:54` (default)                      | `navigate("/(tabs)")`                                      | `MyWatchScreen.tsx:116`, a tab page                                                                                                                                                                                                        | Safe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

No other root-stack route file calls `router.navigate("/(tabs)...")` directly. The check covered `more.tsx`, `account.tsx`, `reader.tsx`, `mission.tsx`, and the watch, series, video, collection, and experience route folders under `apps/mobile/app/`. `apps/mobile/app/reader.tsx:24` uses `router.back()`.

## Related Issues

- `docs/solutions/best-practices/mobile-search-ui-patterns-20260416.md` covers result navigation from the Discover tab, a tab page. A refresh on 2026-09-30 rewrote its navigation section to match the code: `apps/mobile/app/(tabs)/watch.tsx:147-149` pushes an `/experience/<slug>` route for an experience result.
- `docs/solutions/mobile/experience-selection-provider-library-tab-pattern-2026-04-08.md` is the origin of the Library return-to-Home call. It ran on the old Library tab, so it was correct there. PR #2444 moved that UI off the tab, and this learning's PR moved it onto a root-stack screen.
- `docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md` covers the same root `Stack` from another angle: the root stack, not a nested stack, serves the back pop.
- `docs/solutions/best-practices/scrollview-sticky-header-index-drops-falsy-conditional-children.md` covers the same `LibraryDownloads.tsx` empty-state branch, with a different mechanism.
