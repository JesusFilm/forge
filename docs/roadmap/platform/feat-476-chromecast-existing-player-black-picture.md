---
id: "feat-476"
title: "Verify Chromecast Existing Player black-picture fallback"
owner: "ekkasit"
priority: "P1"
status: "not-started"
start_date: "2026-09-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "android-tv"
  - "chromecast"
  - "video-player"
---

## Problem

During feat-475 validation, Settings → Native Android Player Off correctly
selected the existing React player. Its controls and position rendered, but the
Chromecast capture was black. Native Kotlin/TextureView video rendered correctly
on the same device. This does not establish the cause or whether the issue
predates the native branch; the approved native task excluded modifying React.

## Entry Points — Read These First

1. `apps/tv/src/components/VideoPlayer.tsx` — existing expo-video surface and overlay.
2. `apps/tv/app/_layout.tsx` — player choice, teardown, and native/React branch.
3. `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`
   — Android SurfaceView composition constraints.
4. `test-results/android-native-parity-2026-09-05/chromecast-parity-react-player.png`
   — current symptom, not proof of its cause.

## What To Build

- First reproduce through ordinary Settings → details → Play on the final APK,
  confirming the React view is mounted and checking actual TV output and decoder
  state. Compare a cold Existing Player launch with native-to-existing switching.
- Establish whether capture, composition, decoding, or lifecycle causes the
  missing picture before changing code. Do not presume TextureView is the fix.
- After authorization to expand scope, implement the smallest verified fix and
  retest both player choices, Back, and repeat switching.

## Constraints

- Do not change Apple TV, default player preference, or Google TV Home work.
- Preserve uncommitted native-player changes; no whole-branch cherry-pick/reset.
- Do not publish a build or call fallback playback verified from controls alone.

## Verification

- Physical Chromecast `15061HFDD2JYT5`: moving picture plus correct audio/control
  behavior in Existing Player, with screenshots and native view/decoder evidence.
- Native Player still works and the chosen device setting is restored afterward.
- Scope-appropriate tests, typecheck, lint, release build, and diff checks.
