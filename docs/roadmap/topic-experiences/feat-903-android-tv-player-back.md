---
id: "feat-903"
title: "Restore reliable Android TV player Back navigation"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-29"
duration: 1
depends_on: []
blocks: []
tags: [tv, android, playback, focus, navigation]
---

## Problem

During the reviewed-shortlist merge-readiness pass, the owner reported that both
selecting the on-screen Back button and pressing remote Back could not exit the
Android TV player. An earlier scripted remote Back from visible controls worked;
that narrow observation does not establish the reported paths work reliably.

## Entry Points — Read These First

- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerModule.kt`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/BrandedLoadingView.kt`
- `apps/tv/src/components/NativeAndroidPlayer.tsx`
- `apps/tv/app/_layout.tsx`
- `docs/plans/2026-10-29-tv-reviewed-shortlist.md`

## Grep These

`onDismiss|KEYCODE_BACK|onKeyDown|onKeyUp|showChrome|hideChrome|requestFocus|PlaybackLoadingCover`

## What To Build

Reproduce both reported exit paths against the current candidate and unchanged
main on the same emulator. Distinguish hidden controls, visible controls,
paused playback, loading covers and native choice dialogs. Repair demonstrated
causes and test actual remote focus/selection rather than inferring behavior
from a handler's presence. Keep saved progress and the details return destination.

## Constraints and Verification

Use the existing native Media3 player, preserve data, signing, analytics and
recommendations. Do not install on the physical Chromecast. One controller owns
the emulator at a time. Integrate any repair into `codex/tv-reviewed-shortlist`.
Use meaningful behavior tests where appropriate, build the changed native code,
and retain fresh before/after runtime evidence. This user-reported issue is a
merge-readiness requirement; do not mark it complete from the earlier narrow
visible-controls remote Back smoke.

## Completion evidence — 2026-10-29

Reproduced two causes on the packaged candidate: hidden controls consumed the
first remote Back only to reveal controls; a focused on-screen Back disappeared
after the playing-controls timeout, so Select revealed the timebar instead of
exiting. Dismiss wiring itself worked from paused playback, loading and errors.

Integrated repair `d0377137` consumes the Back key pair and dismisses once on
key-up, while preserving scrub cancellation. Focused Back blocks both scheduling
and execution of the hide timer. An independent Astra review found no defect;
dialog handling and other controls' reveal behavior are unchanged.

The new Release QA APK built successfully; 17 native unit tests and 16 relevant
existing Jest checks pass. On `emulator-5562`, one Back from hidden controls
returned to details and preserved a 27:08 resume point. Focused on-screen Back
stayed visible while playback advanced from 27:17 to 27:32 across an uninterrupted
wait longer than six seconds; Select returned to details with Play focused.
Evidence is retained under the build worktree's
`.local-tools/merge-readiness-20261029/fixed-*` files. Physical installation remains
deferred. This completion does not close the separate video-frame investigation.
