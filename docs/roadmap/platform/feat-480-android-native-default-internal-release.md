---
id: "feat-480"
title: "Native Android player default and Play internal test"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-09-07"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "android"
  - "release"
---

## Scope

Make the native Android player the default for new or unset preferences. Keep an
explicit React Native player option in Settings and preserve a stored explicit
choice. Align the Android application ID to the selected Play Console app,
`org.jesusfilm.tv`, while retaining the existing deep-link scheme.

## Entry Points

- `apps/tv/src/lib/watchPreferences.ts` and its colocated tests.
- `apps/tv/src/components/settings/SettingsScreen.tsx`.
- `apps/tv/app.json`, `apps/tv/eas.json`.

## Verification and Delivery

- Focused preference and player-selection tests, typecheck, and lint.
- Quick Android TV emulator smoke: native default, React option, persisted choice.
- Signed AAB using a private upload key, with ARM32 and ARM64 libraries.
- Upload to Watch TV App's Google Play internal testing track and inspect its
  validation and final release state. Google retains the app signing key.
- Keep private credentials out of Git. Preserve the existing local Android work.

## Current Result

2026-09-08 follow-up completed: Play rejected TV compatibility because the
bundled ML Kit scanner implies required portrait support and RECORD_AUDIO
implies required microphone hardware. Mark both features optional through
`apps/tv/plugins/withTVHardwareFeatures.js`, increment Android versionCode to 2,
and verified the final release with `scripts/verify-android-tv-play-apk.js` before
uploading. The audio permission and existing player behavior are unchanged.

Implemented and emulator-smoke-tested. All 129 suites / 1,875 tests, typecheck,
and lint pass. Signed version 1 (1.0.0) was uploaded and published to Play's
internal track on 2026-09-07; Android TV is included in the shared track.

Version 2 is now available on the Active internal testing track with the existing
JFP QA group selected. Play confirms 3,036 supported TV models (previously 6),
and the emulator successfully installed version 2 directly from Google Play.
Physical Chromecast installation still
needs Google/Okta sign-in. Compatibility evidence and current build identity:
`test-results/android-play-compatibility-20260908/summary.md`. Original player
smoke evidence: `test-results/android-native-default-internal-20260907/summary.md`.
