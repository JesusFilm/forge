---
title: "Android TV animation preview restart leaves Settings stuck on Restarting"
date: "2026-10-08"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: animation_settings
symptoms:
  - "Restart app & preview remains disabled on Restarting…"
  - "JavaScript restarts but the previous Settings root stays visible"
root_cause: legacy_release_reload_reuses_root
resolution_type: code_fix
severity: medium
tags: [tv, android, chromecast, expo, restart, startup, lifecycle]
---

## Observed cause

On the physical Chromecast release build (Expo SDK 54, React Native TV 0.81.5,
legacy architecture), `reloadAppAsync` delegated to
`recreateReactContextInBackground()` without replacing the Activity/root. Logs
showed JavaScript restarting followed by the existing-root-ID warning; the old
Animations screen remained visible with its Restarting state.

## Fix and boundary

`apps/tv/src/lib/restartWatchForPreview.ts` awaits the complete preferences write,
then calls the existing Android module's `restartAppForPreview`. Apple keeps its
existing Expo reload.

`PreviewAppRestart.kt` marks the requesting Activity and calls `recreate()`.
`apps/tv/plugins/withAndroidStartupLoading.js` persists an `onDestroy` hook after
`super.onDestroy()`. Only the marked Activity clears the React host, after its old
root has detached. The new Activity creates a fresh runtime/root and the unchanged
startup provider replays the selected intro. Normal Back, warm resume and
configuration recreation must not clear the host.

Do not fix this by killing the process, clearing app data, adding a second intro,
delaying Home or changing the startup sound. Native edits require a rebuilt APK.
This implementation targets the app's explicit `newArchEnabled: false` setting;
revalidate the host-reset strategy before a bridgeless-architecture migration.
Android lifecycle reference: [Activity recreation](<https://developer.android.com/reference/android/app/Activity#recreate()>).

## Verification

152 suites / 2,022 tests, typecheck, lint, formatting, diff check and Android ARM32
release build passed. Tests cover save-before-restart, save/native errors, Apple
isolation, plugin injection/idempotency and the post-super hook.

Chromecast QA code 5 passed two focused D-pad button restarts to selected intro
and usable Home, preserved Startup 09 and Loading 03, and retained warm reopen
without intro replay. Remote Back destinations remained Settings then Home.
Recordings and remaining release gates are in
`docs/plans/2026-10-08-tv-single-loading-effect.md`. ADB recordings contain no
audio, so audible sound requires a separate listening check.
