---
id: "feat-597"
title: "Integrate Android TV weekly performance and remote improvements"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-09-25"
duration: 2
depends_on: []
blocks: []
tags: ["tv", "android-tv", "chromecast", "performance", "player"]
---

## Problem

The feedback branch includes Home startup and branded loading, but not all Android TV improvements reported on September 21. A dirty source worktree holds the missing behavior alongside unrelated and unfinished changes.

## Entry Points — Read These First

1. `docs/plans/2026-09-25-android-report-integration.md` — exact integration scope.
2. `apps/tv/app/watch/[slug].tsx` and `src/hooks/useAndroidVideoDetails.ts` — details fetch path.
3. `apps/tv/src/lib/validateUrl.ts` — canonical Mux URL fast path during large-variant normalization.
4. `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt` — first frame, keys and menu focus.
5. `apps/tv/src/components/search/SearchKeyboard.tsx` — functional query updates.
6. `apps/tv/src/components/feedback/useFeedbackQr.ts` — feedback behavior to preserve.

## Grep These

- `useAndroidVideoDetails|createAndroidVideoDetailsCache`
- `PlaybackLoadingCover|onRenderedFirstFrame|KEYCODE_MEDIA_PLAY_PAUSE`
- `closeMenu|SearchKeyboard|setSanitizedQuery`

## What To Build

Port the remaining report behaviors and regression tests without replacing current feedback or TV device declarations. Build a side-by-side QA APK and verify on the physical Chromecast.

## Constraints

- Do not overwrite or uninstall the Play-signed app.
- Do not claim historical performance figures for the integrated branch without new measurements.
- Do not disable Play Integrity or alter feedback service behavior for the QA package.

## Verification

- TV tests, typecheck, lint, native Kotlin compile, release APK build.
- Physical Chromecast Home, details, Search, Resume/Start over, player keys and menu focus.
- Offline Retry regression where safe, with an explicit limitation if network disconnection would disrupt device access.

## Resolution — 2026-09-25

- Integrated Android no-cache details fetch, an eight-entry five-minute warm cache, and strict canonical Mux stream-URL fast validation. Preserved tvOS details and current feedback paths.
- Integrated the branded Resume/Start over cover through the first rendered frame, media-key first press, Search functional state updates, and player menu focus restoration.
- Full TV suite passed: 138 suites, 1,933 tests. Typecheck, lint, Kotlin compile, and QA release build passed.
- Physical Chromecast QA copy showed Home, JESUS details and a warm revisit, branded Resume and Start over loading followed by decoded video, one-press media Pause, focus returning to Language after menu close, and successive on-screen Search letters. Screenshots are in `/tmp/tv-report-integration-qa/` for this task.
- Offline Retry was covered by existing Home and new details-cache failure/retry tests. A physical offline test was not run because disconnecting Wi-Fi would break the only ADB connection; this remains a release QA limitation. No fresh timing sample was taken, so the report's historical latency figures do not apply to this build.
