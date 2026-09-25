---
id: "feat-553"
title: "Integrate Android startup and branded loading with TV feedback"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-25"
duration: 2
depends_on: []
blocks: []
tags: ["tv", "android-tv", "startup", "feedback"]
---

## Problem

The Android startup worktree has a measured Home speedup and an approved logo-and-dots loader, but its changes are uncommitted and absent from the TV feedback beta builds. That worktree also contains unrelated and unfinished player work plus an older Play manifest configuration, so it cannot be merged wholesale.

## Entry Points — Read These First

1. `docs/plans/2026-09-25-tv-feedback-android-startup-integration.md` — selection and exclusions.
2. `apps/tv/src/hooks/useWatchHome.ts` and `src/lib/watchHome/topUpFetch.ts` — Android Home fetch policy and initial request scheduling.
3. `apps/tv/app/index.tsx` and `src/components/home/homeRailWindow.ts` — initial Home rails and unified reveal.
4. `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/StartupLoadingOverlay.kt` — native loading focus and Back.
5. `apps/tv/src/components/feedback/useFeedbackQr.ts` and `apps/tv/plugins/withTVHardwareFeatures.js` — feedback and Play compatibility to preserve.

## Grep These

- `StartupLoadingOverlay`, `BrandedLoading`, `homeFetchPolicy`
- `mountedRailCount`, `homeRailRenderCount`, `EXPO_PUBLIC_TV_FEEDBACK_URL`
- `android.software.leanback`, `android.hardware.faketouch`

## What To Build

Port only the completed Android Home and branded-loading changes onto the feedback branch. Add focused tests and preserve the existing TV feedback entry points and Play device declarations.

## Constraints

- Leave the dirty source worktree untouched.
- Do not change Apple TV, production services, or store tracks.
- Do not import the source worktree's unfinished native-player, language, subtitle or QA-package changes.

## Verification

Focused JS and native checks, clean Android prebuild, build, and TV navigation/loading smoke. Record physical Chromecast startup timing separately when a device is available. Do not mark complete based solely on source tests.
