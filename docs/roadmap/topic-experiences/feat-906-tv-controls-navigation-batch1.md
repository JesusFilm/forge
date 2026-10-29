---
id: "feat-906"
title: "Repair Watch TV playback controls and Home navigation"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-30"
duration: 3
depends_on: []
blocks: []
tags: [tv, android, apple-tv, focus, playback, navigation]
---

## Problem

Linear TV-34 reports Android OK/Pause and control reachability during playback.
TV-12 reports a hero changing the intended film while focused. TV-13 reports
root Back exiting from deep Home. TV-19 reports incorrect card focus and clipping
after returning from playback. The owner authorized one reviewable batch, with
an explicit user-testing checkpoint before merge or the next batch.

## Entry Points — Read These First

- `docs/plans/2026-10-30-tv-controls-batch1.md`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt`
- `apps/tv/src/components/home/HomeHeroCarousel.tsx`
- `apps/tv/src/components/home/HeroPager.tsx`
- `apps/tv/src/components/home/HomeRail.tsx`
- `apps/tv/src/components/home/focusMemory.ts`
- `apps/tv/app/index.tsx`

## Grep These

`dispatchKeyEvent|revealKeyCode|showControls|AUTO_ADVANCE_MS|heroFocused|createFocusMemory|restoreLastFocus|reloadContinueWatching|hardwareBackPress`

## What To Build

Reproduce the four reports with fresh, normal-paced remote input before choosing
repairs. Make OK/Pause and directional controls usable while playing. Stabilize
focused hero selection and route-aware background rotation. Provide deep-Home
Back-to-top with visible focus while preserving top-level exit. Restore the
selected card and horizontal offset after navigation and asynchronous shelf
updates, without changing ordinary row-entry geometry.

## Constraints

Use GPT-6.1 Sol implementation agents in isolated worktrees and one coordinator.
Combine reviewed changes on `codex/tv-controls-batch1`. Preserve device data,
signing, analytics, native players and current preference/resume flows. Physical
Chromecast installation remains deferred. No direct deployment or store upload.
Prepare a draft PR, tested QA artifact and HTML evidence; await the owner's
explicit approval before merge or implementation of the next batch.

## Verification

TV typecheck, strict lint, meaningful behavioral tests, formatting and relevant
native build checks. Exercise actual Android native and Apple TV Home journeys,
including focused hero dwell and transition-adjacent selection, Home Back,
return focus/offset, playback pause/resume, scrub cancel and saved progress.
Compare Home loading work/timings under matched conditions. Preserve failed
evidence and disclose any environment or physical-device limitations.
