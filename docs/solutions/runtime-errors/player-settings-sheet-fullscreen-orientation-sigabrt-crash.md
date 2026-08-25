---
title: Fullscreen player settings sheet crashes iOS with SIGABRT
date: "2026-08-26"
category: runtime-errors
module: apps/mobile
problem_type: runtime_error
component: frontend_stimulus
severity: critical
symptoms:
  - "Opening the player settings sheet while the watch player is in custom fullscreen crashes the app with SIGABRT on iOS (reproduced twice on iPhone 17 Pro Max simulator, 2026-08-26)."
  - "Crash backtrace runs through RCTModalHostViewComponentView didMoveToWindow -> presentViewController -> an uncaught NSException."
  - "UIKit's _UIFullscreenPresentationController _adjustOrientationIfNecessaryInWindow finds no orientation in common between the presented Modal and the orientation-locked app, then throws."
  - "The app vanishes to the home screen with a clean Metro log — no JS error, no red-box; the only record is a host-side .ips report."
  - "Portrait player + gear tap works every time; fullscreen player + gear tap crashes every time."
root_cause: config_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/components/watch/PlayerSettingsSheet.tsx
  - apps/mobile/src/components/watch/VideoPlayer.tsx
tags:
  - expo
  - react-native
  - modal
  - orientation-lock
  - fullscreen
  - sigabrt
  - ios-crash
  - video-player
framework_version: "expo ~57.0.16 / react-native 0.86.2"
---

# Fullscreen player settings sheet crashes iOS with SIGABRT

## Problem

On `apps/mobile`, opening the player settings sheet while the watch player was
in custom fullscreen crashed iOS with SIGABRT. The app's fullscreen mode locks
orientation to landscape, but the settings sheet's RN `Modal` defaulted to
`supportedOrientations={["portrait"]}`, so UIKit found no orientation in
common between the app and the presented view controller and aborted.

## Symptoms

- The app vanished to the home screen. No crash UI, no error screen inside
  the app.
- Metro showed a clean log. No JS error, no red-box. The throw is native and
  happens mid-presentation, inside UIKit, so JS never sees it.
- The only record of the crash was a host-side `.ips` report in
  `~/Library/Logs/DiagnosticReports/` (`forgewatch-2026-08-26-073057.ips` and
  `forgewatch-2026-08-26-073444.ips` — reproduced twice, identical signature).
- The backtrace showed `RCTModalHostViewComponentView didMoveToWindow` →
  `ensurePresentedOnlyIfNeeded` → `presentViewController` →
  `_UIFullscreenPresentationController _adjustOrientationIfNecessaryInWindow`
  → `-[UIViewController __supportedInterfaceOrientations]` throwing an
  `NSException`. `objc_exception_rethrow` inside a CoreAutoLayout
  `withBehaviors:performModifications:` block escalated to `std::terminate`
  and the process aborted.
- The bug was deterministic: portrait player + gear tap worked every time;
  fullscreen player + gear tap crashed every time.

## What Didn't Work

Three early theories did not hold up:

1. **Suspected a JS error.** The Metro log stayed clean through the crash.
   A JS-side bug would show a red-box or a stack trace in Metro. This crash
   showed neither, which pointed away from JS and toward native code.

2. **Suspected the dev client's known MMKV/native issues.** The mobile app
   has other tracked native quirks on the SDK 57 dev client. None of their
   known crash signatures matched this backtrace. The signature here is
   specific to `RCTModalHostViewComponentView` and orientation adjustment,
   not to MMKV.

3. **First attribution: "dev-client-only orientation quirk."** The SDK 57
   Expo dev client cannot rotate its window (a known `expo-dev-launcher`
   root-view-controller limitation), so fullscreen stayed visually portrait
   on the dev client. That made the crash look like a dev-client artifact.
   This was wrong. The orientation lock in
   `apps/mobile/src/lib/orientation.ts` runs regardless of whether the
   window visually rotates — it is a JS-side call into
   `expo-screen-orientation`, not a window transform. A release build,
   where the window really does rotate, reaches the identical empty
   intersection and crashes the same way. The dev client only hid the
   crash's visual cue; it did not change the mechanism.

## Solution

The fix pins the modal's supported orientations to match the app's landscape
lock while fullscreen is possible.

`apps/mobile/src/lib/orientation.ts:37-45` locks the whole app to a single
landscape orientation on fullscreen entry:

```ts
export async function enterFullscreenLandscape(): Promise<void> {
  const SO = load()
  if (!SO) return
  try {
    await SO.lockAsync(SO.OrientationLock.LANDSCAPE_RIGHT)
  } catch {
    // Non-fatal — orientation unavailable in this context.
  }
}
```

`apps/mobile/src/hooks/useFullscreenPresentation.ts:20-26` calls it whenever
`isFullscreen` turns true:

```ts
useEffect(() => {
  navigation.setOptions({
    orientation: isFullscreen ? "landscape_right" : "portrait",
  })
  if (isFullscreen) void enterFullscreenLandscape()
  else void exitToPortrait()
}, [isFullscreen, navigation])
```

Before the fix, `PlayerSettingsSheet.tsx`'s `Modal` carried no
`supportedOrientations` prop, so React Native applied its default,
`["portrait"]` (on iPhone-class devices; iPad defaults to all orientations,
per `RCTModalHostView.m` in react-native 0.86.2).

After the fix (`apps/mobile/src/components/watch/PlayerSettingsSheet.tsx:156-165`,
part of PR #2026):

```tsx
<Modal
  visible
  transparent
  animationType="slide"
  statusBarTranslucent
  // Fullscreen locks the app to landscape while the Modal's default is
  // portrait-only; UIKit aborts a presentation with no common orientation.
  supportedOrientations={["portrait", "landscape"]}
  onRequestClose={onClose}
>
```

A test in
`apps/mobile/src/components/watch/__tests__/PlayerSettingsSheet.test.tsx:312-314`
pins the prop:

```ts
expect(modals[0].props.supportedOrientations).toEqual(
  expect.arrayContaining(["portrait", "landscape"]),
)
```

This test was red before the fix. After the fix, the sheet presents in
landscape over the fullscreen player, on the same simulator flow that
crashed before.

## Why This Works

UIKit requires a presented view controller's supported interface
orientations to intersect the app's currently allowed orientations. Before
the fix, the app's allowed set was `{landscape}` (from the fullscreen lock)
and the modal's supported set was `{portrait}` (RN's default). The
intersection was empty. `_UIFullscreenPresentationController` computes this
intersection during presentation and, finding no valid orientation to
present in, raises an exception rather than presenting.

Setting `supportedOrientations={["portrait", "landscape"]}` on the `Modal`
widens the modal's set to `{portrait, landscape}`. This always intersects
the app's allowed set, whether the app is locked to portrait (normal
playback) or to landscape (fullscreen). The modal can now present in either
orientation.

## Prevention

- **Any RN `Modal` that can present while the app's orientation lock
  differs from the modal's `supportedOrientations` needs the prop.** Check
  every screen that can reach the modal, not just the modal's default
  mounting screen. `QuizButtonRenderer.tsx`'s `QuizModal`
  (`apps/mobile/src/components/sections/QuizButtonRenderer.tsx:62-68`) has
  the same bare `Modal` with no `supportedOrientations` prop. It is
  reachable only through `SectionDispatcher.tsx:76-77` and
  `ContentDispatcher.tsx:38`, which render SDUI Experience blocks. Neither
  dispatcher is used on `apps/mobile/app/watch/[slug].tsx` or
  `apps/mobile/app/series/[slug].tsx` — the only two callers of
  `useFullscreenPresentation` (confirmed by grep across `apps/mobile/src`
  and `apps/mobile/app`). So `QuizModal` is not reachable from a
  landscape-locked context today. It stays a latent risk: any future work
  that renders a `QuizButtonBlock` from a fullscreen-capable screen must
  add the same `supportedOrientations` fix first.
- **Pin the fix with a test that reads the prop off the actual `Modal`
  instance**, as `PlayerSettingsSheet.test.tsx:312-314` does. A prop
  assertion catches a future refactor that drops the line.
- **Triage rule: "app silently returns to the home screen, Metro log is
  clean" means check the host, not the JS.** Look in
  `~/Library/Logs/DiagnosticReports/` for a `.ips` file matching the app
  name and the crash time. Native crashes during UIKit presentation never
  reach Metro or the RN error overlay.
- **This crash class is invisible to jest.** Jest's `react-test-renderer`
  never drives real UIKit presentation, so no unit test can catch the
  missing-orientation-intersection crash directly — only a device or
  simulator flow that actually presents the modal while fullscreen is
  active can reproduce it. The prop-assertion test above pins the fix, but
  it does not by itself prove the crash is gone; the on-device repro does.

## Related Issues

- `docs/solutions/integration-issues/expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md`
  — same fullscreen/orientation domain and the same "dev client presents
  orientation differently than Release" bug class, but a silent non-rotation
  wedge rather than a crash. That doc explains why the dev client's window
  stays portrait, which is what disguised this crash as dev-client-only.
- `docs/solutions/best-practices/bottom-sheet-migration-expo-sdk54-pitfalls-20260527.md`
  — the sibling watch sheets moved off RN `Modal` to `@gorhom/bottom-sheet`;
  `PlayerSettingsSheet` deliberately stayed on RN `Modal` because a routed
  form sheet cannot present over the fullscreen player, which is why it
  alone hit this Modal pitfall.
- `docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md`
  — another iOS-only native-presentation-layer conflict in the same
  fullscreen player chrome, discovered only on-device.
- Fix vehicle: PR #2026 (`feat(mobile): add playback speed and quality
settings to the player`), open as of this writing.
