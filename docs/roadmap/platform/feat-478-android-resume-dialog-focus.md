---
id: "feat-478"
title: "Android Keep watching dialog visible native focus"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-09-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "android-tv"
  - "focus"
---

## Problem

On physical Chromecast, the Keep watching React Native Modal has real D-pad
focus on Start over/Cancel but does not paint focus feedback. The red Resume
check remains visible regardless of focus, making the chooser unusable.
The installed RN-TV DialogRootViewGroup does not forward requestChildFocus to
its TV input helper; the app's Pressable focus-event bridge receives no updates.

## What To Build

- On Android only, use the existing Kotlin choice-dialog chrome for this chooser.
- Resume initially focused; Up/Down visibly selects Resume, Start over, Cancel.
- Preserve saved resume position and callbacks; Back/Cancel dismiss without play.
- Scope asynchronous requests by id, resolve each dismissal once, and dispose the
  native dialog on React unmount or module destruction. Apple keeps its current UI.

## Entry Points

- `apps/tv/src/components/watch/ResumeChoicePanel.tsx`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerModule.kt`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativePlayerChrome.kt`

## Verification

- Regression tests for native request cancellation and result callbacks.
- Typecheck, lint, TV tests, release build, format and diff checks.
- Physical Chromecast: initial white Resume focus, all three visible focus states,
  Cancel/Back, Resume at saved position, Start over at zero, reopen reliably.

## Result — 2026-09-05

- Reused native Kotlin choice chrome on Android; Apple keeps the existing Modal.
- Physical Chromecast: Resume, Start over, and Cancel each displayed a white
  focused row with dark text. Cancel and hardware Back dismissed; reopening
  restored Resume focus. The run was restarted after concurrent user remote input.
- Resume from the saved 0:49 and then 2:29 positions continued playback beyond
  those positions. Start over from a saved 3:08 restarted the film; playback was
  observed at 0:38 and paused at 0:43. The first-frame timestamp was not sampled.
- Typecheck, lint, 127 suites / 1,867 tests, release build, and diff check pass.
- APK SHA-256: `47b66da9d643c1db2bb60495cc97c19c498e61df22b6f5743a5ddcf51b379468`.
- Verified screenshots: `test-results/android-resume-dialog-2026-09-05/`.
- Installed locally on Chromecast; no commit, push, or publication.
