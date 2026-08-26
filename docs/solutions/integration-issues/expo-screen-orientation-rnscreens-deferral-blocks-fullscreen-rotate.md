---
title: "Setting a react-native-screens orientation screen option is what breaks fullscreen rotation on the Expo dev client"
date: 2026-08-26
category: integration-issues
module: "apps/mobile — fullscreen watch/series player (orientation lock)"
problem_type: integration_issue
component: frontend_stimulus
severity: high
symptoms:
  - "Tapping Fullscreen on the video details page enters fullscreen but the window stays PORTRAIT (dev client only; a Release build rotates)."
  - "After rotating the device to landscape in fullscreen, leaving fullscreen strands the details page in landscape until the route is popped with the back button."
  - "expo-screen-orientation's lockAsync resolves without error while nothing rotates."
  - "The simulator log carries UIKit's UIWindowScene.interfaceOrientationsNotSupported — 'None of the requested orientations are supported by the view controller' — once per geometry request."
  - "A cold deep-link open of the watch route shows an opaque black player: no poster, no chrome, and no recovery except leaving the screen. PlayerSlot's one-shot measureInWindow dropped its callback, so the slot rect stayed null and PlaybackHost drew nothing."
root_cause: config_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/hooks/useFullscreenPresentation.ts
  - apps/mobile/src/lib/orientation.ts
  - apps/mobile/src/components/watch/PlayerSlot.tsx
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
    player-slot,
    measureinwindow,
    black-frame,
  ]
framework_version: "expo 57.0.16 / expo-dev-launcher 57.0.15 / expo-screen-orientation 57.0.1 / react-native-screens 4.26.2"
---

# Setting a react-native-screens orientation screen option is what breaks fullscreen rotation on the Expo dev client

## Problem

On the mobile Watch route, tapping Fullscreen must rotate the app to landscape,
and leaving fullscreen must restore portrait. On an Expo dev client neither
happened: fullscreen engaged in portrait, and once the device had been rotated
to landscape by hand, leaving fullscreen left the details page in landscape
until the route was popped.

A prior investigation
(`expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md`, 2026-08-17) concluded
this was an unavoidable dev-client limitation and that orientation must only be
judged on a Release build. That conclusion held for the code as it stood. It was
not the whole story: the app was ARMING the broken path itself, and could stop.

## Symptoms

- Tap Fullscreen on a dev client: the player goes fullscreen, the window stays
  portrait, no error and no log from the app.
- A Release build of the same commit rotates on tap and restores portrait on
  exit.
- `lockAsync()` resolves; nothing rotates.
- The decisive line, from
  `xcrun simctl spawn <udid> log stream --level debug --predicate 'eventMessage CONTAINS[c] "orientation"'`:

  ```
  [com.apple.CFBundle:strings] … key: UIWindowScene.interfaceOrientationsNotSupported,
  value: None of the requested orientations are supported by the view controller.
  Requested: %@; Supported: %@
  ```

  It appears TWICE per fullscreen tap, ~70ms apart — once for
  expo-screen-orientation's `requestGeometryUpdate` and once for
  react-native-screens' `enforceDesiredDeviceOrientation`. Both are refused, so
  this is not a race between the two layers: the view controller UIKit asks
  genuinely does not report landscape.

## Root Cause

`expo-screen-orientation`'s `ScreenOrientationViewController` has a branch
(`ios/ScreenOrientationViewController.swift`):

```swift
override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
  if let vc = vcWithRNScreenOrientation() {
    if vc === self { return super.supportedInterfaceOrientations }
    return vc.supportedInterfaceOrientations
  }
  let mask = screenOrientationRegistry.requiredOrientationMask()
  return !mask.isEmpty ? mask : defaultOrientationMask
}
```

`vcWithRNScreenOrientation()` is non-nil as soon as ANY react-native-screens
screen carries an `orientation` option. From that moment the registry mask —
the plain value `lockAsync` writes, which needs no view-controller traversal —
is ignored, and the answer is resolved by walking the react-native-screens view
controller chain instead.

In a dev client that chain has an extra link.
`ExpoDevLauncherReactDelegateHandler.swift` (greenfield branch) adds
`DevLauncherViewController` as a child of the window root, and its own comment
says so:

```
// Note: this inserts DevLauncherViewController between ScreenOrientationViewController
// (the window root VC) and RNSNavigationController, which blocks react-native-screens'
// single-level VC traversal for orientation and other window traits.
```

`vcWithRNScreenOrientation()` has a one-level-deeper search meant to work around
exactly this, and it is present in the installed source — but the resolved mask
still comes back without landscape, so UIKit refuses both geometry requests.

So the deferral branch is the switch. The app was throwing it by setting the
screen option, and the screen option bought nothing: `src/lib/orientation.ts`'s
`lockAsync` already names the orientation, on both platforms.

## Solution

`useFullscreenPresentation` no longer sets the react-native-screens screen
option. The expo lock is the only orientation writer:

```ts
// The expo-screen-orientation lock is the ONLY orientation writer here. A
// react-native-screens `orientation` screen option makes expo defer to a VC
// chain the dev-client launcher breaks, and UIKit then refuses the rotation.
useEffect(() => {
  if (isFullscreen) void enterFullscreenLandscape()
  else void exitToPortrait()
}, [isFullscreen])
```

With no screen carrying an orientation, `ScreenOrientationViewController`
answers from `screenOrientationRegistry.requiredOrientationMask()`. That value
is whatever `lockAsync` last wrote; resolving it touches no view controller
below the window root, so the dev client's extra link cannot break it.

Two tests pin the invariant, and each was falsified by re-inserting the removed
line:

- `src/hooks/__tests__/useFullscreenPresentation.test.tsx` asserts no
  `setOptions` call — on the screen or its parent — ever carries an
  `orientation` key, in either fullscreen state.
- `app/__tests__/screenOrientationOption.guard.test.js` reads every source file
  under `app/` and `src/hooks/` and fails on a screen-orientation option
  anywhere. Its first version matched only `orientation: "literal"` and missed
  the TERNARY the reverted code actually used
  (`orientation: isFullscreen ? "landscape_right" : "portrait"`) — it passed
  against a real regression. The shipped pattern tolerates a gap between key and
  value, across line breaks, stopping at `=` or `;` so a TypeScript annotation
  near a string literal stays clear.

## What the removal exposed: the slot's one-shot measure

Removing the screen option made a SECOND, pre-existing defect much more likely,
and it had to be fixed in the same change.

`PlayerSlot` publishes its rect from a single `onLayout` →
`measureInWindow` call, and `PlaybackHost` bails out (`return null`) while that
rect is null. `measureInWindow` silently drops its callback when the native node
is not attached yet — no error, no second chance — so an unlucky cold open left
the host drawing nothing behind an opaque black slot, permanently. Tapping did
not recover it; only leaving and re-entering the screen did.

Instrumenting `measureIntoStore` on the simulator separated the two cases
exactly:

```
RESULT: OK      [SLOTPROBE] onLayout fired   [SLOTPROBE] measure {"x":0,"y":62,"width":440,"height":248}
RESULT: BLACK   [SLOTPROBE] onLayout fired
```

`onLayout` fires in both. The measure callback fires only in the good one.

Measured over 10 cold deep-link opens each (same script, same sleeps):

| Build                                  | Black player |
| -------------------------------------- | ------------ |
| main, unchanged                        | 2 / 10       |
| orientation fix only                   | 6 / 10       |
| orientation fix + slot retry (shipped) | 0 / 10       |

**The mechanism of the 2→6 shift was not established** — the probe shows one
`onLayout` in both the good and bad runs, so the obvious "the extra `setOptions`
render gave the measure a second chance" story is not supported by the evidence.
What the numbers do say is that the rate moved, so the slot was made independent
of how many times its screen happens to render: a bounded
`requestAnimationFrame` pump re-measures until a rect lands, a zero-size measure
is refused, and `isDrawn` now requires the rect rather than the attachment, so
the slot keeps its own poster up instead of clearing to black while the host has
nothing to draw.

## Verification

iPhone 17 Pro Max simulator, iOS 26.4, 2026-08-26. The same four steps were run
on both build types:

| Step                                        | Dev client before | Dev client after | Release after |
| ------------------------------------------- | ----------------- | ---------------- | ------------- |
| Tap Fullscreen (device portrait)            | portrait          | landscape        | landscape     |
| Rotate device to landscape while fullscreen | portrait          | landscape        | landscape     |
| Leave fullscreen while device is landscape  | landscape         | portrait         | portrait      |
| Pop back to Home                            | portrait          | portrait         | portrait      |

The dev client under test was built from the same worktree, so it carries
expo-dev-launcher 57.0.15 — the failure is not a stale-client artifact.

Also verified on the Release build: `/series/[slug]` (the other caller of the
hook) rotates on enter and returns to portrait on exit from a landscape-held
device, and the player settings sheet opens over the landscape fullscreen player
without the SIGABRT that PR #2026 fixed. **Android is unverified at runtime.**
Reading the sources, it should improve: `expo-screen-orientation`'s `lockAsync`
sets `activity.requestedOrientation` directly, and react-native-screens'
`ScreenWindowTraits.setOrientation` — which writes
`SCREEN_ORIENTATION_UNSPECIFIED` for any screen without the trait, and only runs
at all once some screen has set one — now never runs.

## Prevention

- **Never set a react-native-screens `orientation` screen option in this app.**
  One screen setting one is enough to switch every orientation decision onto the
  fragile path, including screens that never set it. The guard test is the
  enforcement.
- **A JS-visible success proves nothing here.** `lockAsync` resolves whether or
  not UIKit acts on the mask. The observable that separates "wrong mask value"
  from "UIKit refused" is the simulator log line above — reach for
  `simctl spawn … log stream` before theorising about mask semantics.
- **Two rejections ~70ms apart mean it is not a race.** If only the earlier one
  were refused, the fix would be ordering. Both being refused says the view
  controller UIKit asks does not report the orientation at all.
- **Release-only verification is no longer required for this path**, but it is
  still required for anything that depends on the react-native-screens window
  traits the dev-launcher nesting blocks (status bar, home indicator). Those
  were not re-measured here.

## Related Issues

- `docs/solutions/integration-issues/expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md`
  — the 2026-08-17 investigation this supersedes. Its mechanism (the launcher's
  VC nesting) is correct; its conclusion ("the dev client cannot force rotation,
  full stop") was scoped to a codebase that set the screen option.
- `docs/solutions/runtime-errors/player-settings-sheet-fullscreen-orientation-sigabrt-crash.md`
  — the same landscape lock, seen from the modal-presentation side. That fix
  (`supportedOrientations` on the settings sheet's `Modal`) is unaffected and
  still required; this change makes the dev client actually reach landscape, so
  the crash it prevents is now reachable there too.
- `docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md`
  — the sibling geometry-timing bug in the same hoisted player. Read them
  together: that one is React commit ordering, this one is native-bridge
  attachment timing. Both end with the host drawing at a rect that is wrong or
  absent.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`
  — the law the retry answers to. The bounded pump is a gate release, so its
  exhaustion path logs once rather than stopping silently.
