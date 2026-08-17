---
title: "Fullscreen watch route stopped auto-rotating to landscape: expo-dev-launcher 57 replaces the root view controller expo-screen-orientation needs"
date: 2026-08-17
category: integration-issues
module: "apps/mobile — fullscreen watch player (orientation lock)"
problem_type: integration_issue
component: tooling
symptoms:
  - "Entering fullscreen on the watch route no longer auto-rotates the device to landscape in the Expo dev client; only a physical device rotation changes orientation."
  - "expo-screen-orientation's lockAsync(LANDSCAPE) resolves successfully but getOrientationAsync still reports PORTRAIT_UP immediately after, confirmed via instrumentation."
  - "The identical pre-SDK-57-upgrade code also failed to rotate in the dev client, falsifying both the dual-orientation-mask and cross-layer-disagreement hypotheses tested first."
  - "A Release simulator build of the same app rotates to landscape on fullscreen enter and restores portrait on exit; the dev client cannot rotate under any orientation-mask combination."
root_cause: config_error
resolution_type: code_fix
severity: high
tags:
  [
    expo-screen-orientation,
    expo-dev-launcher,
    react-native-screens,
    fullscreen,
    orientation-lock,
    dev-client,
    expo-sdk57,
    landscape,
  ]
framework_version: "expo 57.0.12 / expo-dev-launcher 57.0.11 / expo-screen-orientation 57.0.1"
---

# Fullscreen watch route stopped auto-rotating to landscape: expo-dev-launcher 57 replaces the root view controller expo-screen-orientation needs

## Problem

Fullscreen on the mobile Watch route (Video Details Page) must rotate the app
to landscape. Before Expo SDK 57, tapping Fullscreen forced the rotation.
After the SDK 54 -> 57 upgrade, tapping Fullscreen did nothing. Only a
physical tilt of the device rotated the screen. Exiting fullscreen still
correctly restored portrait, because the app locks a single orientation
(`PORTRAIT_UP`) on exit and that mask always wins.

## Symptoms

- Tap Fullscreen: the UI stays in portrait. No error. No log.
- Physically rotate the device while in fullscreen: the UI rotates fine.
- Exit fullscreen: the UI returns to portrait immediately, every time.
- `expo-screen-orientation`'s `lockAsync()` call resolves without throwing.
- `getOrientationAsync()` right after the lock still reports `1`
  (`PORTRAIT_UP`) — the lock call succeeds, but nothing rotates.

## What Didn't Work

Each of these steps was a reasonable hypothesis. Each one failed to fix the
bug, and each failure narrowed the search.

**Hypothesis A — wrong lock mask.** `expo-screen-orientation`'s dual
`OrientationLock.LANDSCAPE` mask only _permits_ landscape. On iOS 16+ the
geometry request then defers to the physical sensor, so a portrait-held phone
stays portrait until the user tilts it. Only a single-orientation mask forces
the rotation. The team changed `enterFullscreenLandscape()` to lock
`LANDSCAPE_RIGHT` instead of `LANDSCAPE`. Result: the simulator still did not
rotate. Worse, the dual mask had appeared to rotate once earlier in the same
process — that one success was a leftover process-state artifact, not a real
pass, and it poisoned the baseline the team was comparing against.

**Hypothesis B — cross-layer disagreement.** `useFullscreenPresentation`
also sets a react-native-screens screen option
(`navigation.setOptions({ orientation })`). With the screen option set to the
dual `"landscape"` string and the lock set to single `LANDSCAPE_RIGHT`, each
layer's geometry request could fall outside the other layer's mask. The team
aligned both layers to `landscape_right`. Result: still no rotation on the
dev client.

**Controlled experiment — restore the old combination.** To rule out a
regression in the fix itself, the team restored the exact pre-upgrade
combination: dual `"landscape"` screen option plus dual `LANDSCAPE` lock.
Result: this also did not rotate. Both hypotheses were now falsified for the
environment under test — the bug was not about which mask value to pick.

**Instrumentation.** The team called `lockAsync(LANDSCAPE_RIGHT)` and then
immediately read back `getOrientationAsync()`. The lock resolved with no
error. The read-back still reported `PORTRAIT_UP`. The lock call succeeds,
but iOS never rotates the interface — the problem is upstream of the mask
value.

## Solution

The team read the installed native sources of `expo-screen-orientation` and
`expo-dev-launcher` at both the old and new SDK versions, and found a
difference in which view controller sits at the window root on the dev
client. Full mechanism in "Why This Works" below.

The fix that shipped (PR #1948, branch `fix/mobile-hero-suspend-fullscreen-rotate`,
open and unmerged as of this writing) keeps the single-orientation lock from
Hypothesis A and the cross-layer alignment from Hypothesis B — it is the
configuration verified to work on a Release build, and it removes any way
for the two layers to disagree:

`apps/mobile/src/lib/orientation.ts:41` locks a single orientation:

```ts
await SO.lockAsync(SO.OrientationLock.LANDSCAPE_RIGHT)
```

`apps/mobile/src/hooks/useFullscreenPresentation.ts:26` names the same single
orientation on the react-native-screens screen option:

```ts
orientation: isFullscreen ? "landscape_right" : "portrait",
```

The comment at `apps/mobile/src/lib/orientation.ts:28-36` records why the
lock is single, not dual, and why the code never calls `unlockAsync()`
afterward — an unlock on iOS re-applies the device's physical orientation,
which snaps a portrait-held phone straight back to portrait and undoes the
landscape nudge. The comment at
`apps/mobile/src/hooks/useFullscreenPresentation.ts:23-25` states the
constraint plainly: the screen option and the lock must name the same single
orientation, or each layer's geometry request falls outside the other
layer's supported mask.

Two test suites pin both layers so a future edit cannot silently reintroduce
the disagreement:

- `apps/mobile/src/lib/__tests__/orientation.test.ts` asserts
  `enterFullscreenLandscape()` locks `LANDSCAPE_RIGHT`, never the dual
  `LANDSCAPE` mask, and never calls `unlockAsync()`.
- `apps/mobile/src/hooks/__tests__/useFullscreenPresentation.test.tsx`
  asserts `setOptions` receives `orientation: "landscape_right"` on enter
  and `orientation: "portrait"` plus `exitToPortrait()` on exit.

An adversarial code reviewer independently verified the cross-layer string-to-
mask mapping in the installed native sources on both platforms, so the two
layers' literal values are confirmed to mean the same physical orientation:
on iOS, `RNScreens`' `RNSScreen.mm` maps `"landscape_right"` to
`UIInterfaceOrientationMaskLandscapeRight`, and expo's
`ModuleOrientationLock.swift` maps lock value `7` to `.landscapeRight`; on
Android, `Screen.kt` maps `"landscape_right"` to
`SCREEN_ORIENTATION_LANDSCAPE`, and expo's `OrientationLock.kt` maps
`Landscape(7)` to the same constant. The accepted trade-off: a 180-degree
flip while already in fullscreen landscape no longer re-triggers a rotation,
because the lock and the screen option both name a single fixed orientation
rather than a mask that would let the device choose between left and right.

## Why This Works

`expo-screen-orientation`'s `ScreenOrientationViewController` decides which
orientations iOS may show by overriding `supportedInterfaceOrientations`.
When react-native-screens has set a per-screen orientation, this override
defers to that screen's own view controller
(`node_modules/.pnpm/expo-screen-orientation@57.0.1.../ios/ScreenOrientationViewController.swift:66-82`).
That deferral — and the lock set via `lockAsync` — only has any effect if
`ScreenOrientationViewController`'s own instance is the one actually
installed as the window's `rootViewController`. If some other view
controller sits at the window root instead, no JavaScript call from either
library — any mask, any lock — can force the interface to rotate, because
UIKit never asks `ScreenOrientationViewController` what orientations it
supports.

Comparing the two installed `expo-dev-launcher` versions shows exactly that
difference. At SDK 54,
`ExpoDevLauncherReactDelegateHandler.swift:105-114` unconditionally builds
the root view controller from `self.reactDelegate?.createRootViewController()`
— which is `expo-screen-orientation`'s own `ScreenOrientationViewController`
— and assigns it directly: `window.rootViewController = rootViewController`.

At SDK 57, the same handler
(`node_modules/.pnpm/expo-dev-launcher@57.0.11.../ios/ReactDelegateHandler/ExpoDevLauncherReactDelegateHandler.swift:119-150`)
instead builds its own `DevLauncherViewController` and only _nests_ it under
whatever view controller was already the window root (the "greenfield"
branch), or — if no window root exists yet — uses the launcher's own view
controller as the effective root directly (the "brownfield" branch). The
file's own comment at lines 128-132 acknowledges the nesting problem this
creates: inserting `DevLauncherViewController` between
`ScreenOrientationViewController` and the RNScreens navigation controller
"blocks react-native-screens' single-level VC traversal for orientation and
other window traits," and documents a one-level-deeper child search in
`ScreenOrientationViewController.vcWithRNScreenOrientation()`
(`ScreenOrientationViewController.swift:106-124`) as the intended
workaround for it. Despite that workaround being present in the installed
source, this session's instrumentation (`lockAsync` resolving while
`getOrientationAsync` kept reporting `PORTRAIT_UP`) showed programmatic
rotation still does not happen on the SDK 57 dev client — the forcing chain
is broken there regardless of which mask or lock value the app requests.

None of this VC nesting exists in a Release build. `expo-dev-launcher`'s own
`expo-module.config.json` declares `"debugOnly": true` for the Apple platform
(`node_modules/.pnpm/expo-dev-launcher@57.0.11.../expo-dev-launcher/expo-module.config.json:9`),
so Release builds exclude the whole module. The standard Expo launch path
then installs `ScreenOrientationViewController` directly as the window root,
with nothing between it and RNScreens' navigation controller — so
`vcWithRNScreenOrientation()`'s self-check finds the right screen on the
first try, and the lock takes effect immediately. That is why a Release
build rotates on tap and the dev client does not, no matter which
orientation values the app code passes.

## Prevention

**Never judge orientation-forcing behavior on the SDK 57 dev client.** It
cannot force a programmatic rotation at all, independent of mask choice. Any
test of "does Fullscreen force landscape" must run on a Release build.

**Symptom signature to recognize this class of bug fast:** physical
rotation works, but programmatic forcing does not, and the lock call resolves
without error. That combination means the forcing chain itself is broken
(wrong view controller at the window root, or an intermediate VC blocking
it) — it does not mean the orientation mask value is wrong. Chasing mask
values (as Hypotheses A and B did) burns time when the real defect is one
layer up, in which native view controller UIKit is actually asking.

**A one-off observed rotation inside a long-lived dev-client process is not
a baseline.** The dev launcher's root view controller can differ across
reloads within the same process, so a single earlier success does not
confirm the current configuration works — re-verify on a fresh Release
build, not a hot-reloaded dev session.

**Verification recipe** used to confirm the fix and to re-check this class
of bug in the future:

```bash
npx expo prebuild -p ios --clean
npx expo run:ios --configuration Release
```

The prebuild step is required first — a Release run against a stale
prebuilt project can silently reuse dev-client native code. This project
also needs an MMKV 2.4.1 compile fix on this path: a Podfile `post_install`
hook must add `__STDC_WANT_LIB_EXT1__=1` to the `MMKVCore` target, or the
Release build fails on `memset_s`. On the iPhone 17 Pro Max simulator
(portrait-held, no physical sensor), tapping Fullscreen on a Release build
rotates the interface to landscape immediately; Exit fullscreen restores
portrait.

**Both orientation layers must name the same single orientation.** When
`useFullscreenPresentation`'s react-native-screens `orientation` screen
option and `orientation.ts`'s `expo-screen-orientation` lock diverge — even
by mask shape (dual vs. single), not just by direction — each layer's
geometry request can fall outside the other layer's supported mask and iOS
rejects the rotation. This agreement holds only for the pinned library
versions in this repo; re-verify the string-to-mask mapping in
`RNSScreen.mm` / `ModuleOrientationLock.swift` (iOS) and `Screen.kt` /
`OrientationLock.kt` (Android) after any react-native-screens or
expo-screen-orientation version bump.

## Related Issues

- PR #1948 — the shipped fix (`fix(mobile): hero scroll-suspend playhead reset + fullscreen landscape rotation`).
- `docs/solutions/runtime-errors/expo-router-standalone-no-scheme-launch-crash-20260623.md` — same bug class: Expo behavior diverges by build type (there standalone vs dev client; here dev client vs Release), with the same "never baseline on the wrong build type" prevention shape.
- `docs/solutions/ui-bugs/expo-splash-screen-sdk57-full-bleed-default-change.md` — same SDK 54 -> 57 upgrade window; a native default silently changed with no build error, caught only by post-upgrade verification.
- `docs/solutions/developer-experience/expo-dev-client-cached-bundle-verification.md` — sibling caution in the dev-client-can-mislead family (stale cached bundle rather than root-VC ownership).
