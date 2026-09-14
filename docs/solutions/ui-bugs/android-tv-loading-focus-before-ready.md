---
title: "Android TV loading must own focus before actions are ready"
date: "2026-09-05"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: native_android_player
symptoms:
  - "App startup has a blank interval before React can display a spinner"
  - "Details actions appear before data is ready and remote input has no visible target"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags:
  - android-tv
  - startup
  - loading
  - focus
---

## Solution

Separate native startup from application data readiness. A loader written only
in React cannot cover JavaScript initialization. The MainActivity prebuild plugin
adds `StartupLoadingOverlay` after native `super.onCreate`; it owns a native Back
button and displays Starting app until RootLayout signals that React mounted.
Remove its focus guard and Back callback when the overlay detaches.

For Home without a model and pending movie metadata/preferences, render no movie
actions. Use the native loading dialog with an indeterminate spinner and one
white-focused Back row. Only the focused route may own the dialog. Normal ready
cleanup dismisses it without invoking navigation, while user cancellation goes
back. Request ids and a live flag reject late callbacks from unmounted routes.

Keep cached usable Home content interactive during revalidation. This is loading
feedback and input safety, not an optimization of the metadata request itself.
Do not fabricate percentage progress for unmeasured metadata loading.

The loading panel is opaque so the fallback React spinner/text cannot bleed
through. Unready or unplayable Play is never an actionable button. The Apple TV
paths retain their original behavior.

## Build and verification

Use the idempotent `withAndroidStartupLoading` plugin, not only a manual edit to
the ignored MainActivity output. The native library needs Activity/Core APIs at
the versions already resolved by the app; compile-only Core conflicted with
Expo's consistent runtime/compile resolution, so normal library dependencies
declare those matching versions.

On Chromecast, record cold startup through readiness and inspect actual focus.
Test early directional presses plus Select: the only action must be Back, never
Play or a language change. Confirm normal completion returns visible focus to
the ready screen. Preserve user preferences and coordinate remote ownership.
