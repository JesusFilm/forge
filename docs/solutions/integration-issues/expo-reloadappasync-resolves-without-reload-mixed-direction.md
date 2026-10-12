---
title: "Android reloadAppAsync can resolve without a reload, and a saved layout direction then mixes the screen"
date: "2026-10-13"
category: integration-issues
module: "apps/mobile — mirrored layout direction reload (feat-694)"
problem_type: integration_issue
component: tooling
symptoms:
  - "After a per-app language change from Arabic to English on Android, English text is right-aligned over a left-to-right layout"
  - "The direction return reload does not happen: logcat has no 'Starting React Native reload' line for that return"
  - "reloadAppAsync resolves with no error, so the app reports nothing"
  - "It occurred once in 14 switches on a Pixel 9a emulator (Android 15) and did not occur again in 13 later switches"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
framework_version: "expo-modules-core 57.0.21 and 57.0.22, react-native 0.86.3"
retire_when: "expo-modules-core CoreModule.reloadAppAsync rejects, or reports, when it cannot reload; check the AsyncFunction in android/src/main/java/expo/modules/kotlin/defaultmodules/CoreModule.kt of the installed version"
related_components:
  - apps/mobile/src/i18n/layoutDirection.ts
  - apps/mobile/modules/layout-direction
  - expo-modules-core CoreModule.reloadAppAsync
  - react-native FabricUIManager and I18nUtil
tags:
  - expo
  - reload-app-async
  - android
  - rtl
  - layout-direction
  - fabric
  - deadline
  - restore
---

# Android reloadAppAsync can resolve without a reload, and a saved layout direction then mixes the screen

## Problem

The mirrored layout (feat-694) applies a new direction by a save and then a reload. On Android, `reloadAppAsync` can resolve and not reload. The save had already changed the direction that React Native's native layout reads, so the runtime that did not reload showed a screen with two directions.

## Symptoms

- Arabic to English with a per-app language change: English text right-aligned, inside a left-to-right layout.
- No `Starting React Native reload` line in logcat for that return, and no error or Datadog report.
- Seen once in 14 switches on the Pixel 9a emulator (Android 15), 2026-10-13. Thirteen later switches did not show it.

## What Didn't Work

- **Treating a resolved promise as a reload.** The first controller awaited `reloadAppAsync` and handled only a rejection. A resolution with no reload went to no path.
- **Clearing only the reload record on failure.** The first failure path cleared the reload count and kind, but React Native's own direction prefs kept the new direction. The runtime that continued then laid out in the new direction under JavaScript styles from the old one.
- **Reproducing it on demand.** A script that repeated the same per-app language switch did not show it again in 13 runs. So the fix comes from the code paths that can resolve without a reload, and only jest tests cover it.

## Solution

`apps/mobile/src/i18n/layoutDirection.ts` (`reloadFor`, PR #2695, unmerged as of this writing):

1. Arm a deadline before the first save: `RELOAD_DEADLINE_MS` (8000 ms). A reload ends the runtime, so a timer that fires means the reload did not happen.
2. When the reload rejects, or the deadline fires, restore: save the direction in use again (React Native's prefs and the native mode, with a reload count of 0), apply the native mode in use, and report `reload_failed` or `reload_stalled`.
3. Release the start gate after the restore, or after `RESTORE_WAIT_MS` (1000 ms) when a native call does not settle.
4. After the first save, skip the reload when the restore already ran, because that save ended after the deadline.

```ts
const deadline = setTimeout(
  () => void restore("reload_stalled"),
  RELOAD_DEADLINE_MS,
)
try {
  await layout.saveDirection({
    isRTL: decision.wantedRTL,
    nativeMode: decision.nativeMode,
    reloadCount: 1,
    reloadKind: kind,
    reloadBundle: bundle,
  })
  // A save that ended after the deadline: the restore has run, so no reload.
  if (restored) return
  await reloadAppAsync("layout direction")
} catch (error) {
  clearTimeout(deadline)
  await restore("reload_failed", error)
}
```

## Why This Works

Two facts together make a resolved, unreloaded runtime harmful:

- **`reloadAppAsync` can resolve with no reload.** In expo-modules-core 57.0.22, `CoreModule.kt:94-98` returns with no reload when the current activity is not a `ReactActivity`, or when its `reactDelegate` is null. React Native's `ReactDelegate.reload()` (`ReactDelegate.kt:286-300`) also returns silently when its dev-support manager, host, or instance is missing. In each case the promise resolves. (A missing activity is different: `throwingActivity` throws, so the promise rejects.) Which path caused the one stall is not established, because it did not occur again.
- **The native layout reads the saved direction again; JavaScript does not.** `FabricUIManager.java:1054` reads `I18nUtil.getInstance().isRTL(context)` each time the root view's layout specs update. `I18nUtil.kt:22-24` computes that from the app's `supportsRtl` flag and the `RCTI18nUtil_forceRTL` and `RCTI18nUtil_allowRTL` prefs, and the prefs are what the save writes. In this session's tests, the JavaScript value from `I18nManager.getConstants().isRTL` stayed fixed for the runtime.

So a save that sets the new direction changes the native layout of the runtime that is still running, at the next root layout update. Only a real reload makes JavaScript agree. The deadline turns "no reload" into a detected state, and the restore puts back every value that the running runtime reads, so both sides agree again on the old direction.

## Prevention

- Do not treat a resolved `reloadAppAsync` as proof of a reload. Arm a time limit before the first write, and treat "the runtime is still alive at the deadline" as a failure.
- When a save changes a value that the running runtime reads, the failure path must put that value back. Clearing only the bookkeeping record is not a restore.
- Give a gate that waits on a reload a release that does not depend on a native call. A restore that awaits a hung native call must not keep the gate shut.
- Tests in `apps/mobile/src/i18n/__tests__/layoutDirection.test.ts` use fake timers. They cover a reload that rejects, a reload that never ends the runtime (start and Android return), a restore from both directions on both platforms, a save that ends after the deadline, and a restore save that never settles. Falsified by hand on 2026-10-13: the restore tests fail when the restore saves a fixed left-to-right direction, and the late-save and gate tests fail when their checks are removed.
- Device check on Android: background the app, run `adb shell cmd locale set-app-locales <package> --locales en-US`, bring the app to the front, and count `Starting React Native reload` lines in logcat. Expect exactly one.

## Related Issues

- `docs/solutions/ui-bugs/android-tv-preview-restart-stale-root-20261008.md`: another `reloadAppAsync` call on Android (TV, legacy architecture) that gave no clean reload.
- `docs/solutions/logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`: arm a watchdog on intent, not on the success of the thing it guards.
- `docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md`: a gate with no time-based release path stays shut.
- `apps/mobile/CLAUDE.md`, "Mirrored layout (feat-694)" > "A reload that does not happen".
