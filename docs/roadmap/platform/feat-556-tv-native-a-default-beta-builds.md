---
id: "feat-556"
title: "Default Apple TV to Native A and distribute TV beta builds"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-25"
duration: 1
depends_on: []
blocks: []
tags: ["tv", "tvos", "android-tv", "testflight", "google-play"]
---

## Problem

Apple TV still defaults to the React player, including older installations with a stored `existing` value. The next TV beta builds should use Native A by default and include the feedback-QR cleanup and Android improvements on the current branch.

## Entry Points — Read These First

1. `docs/plans/2026-09-25-tv-native-a-default-beta-distribution.md` — scope and verification.
2. `apps/tv/src/lib/watchPreferences.ts` — default, migration, persistence.
3. `apps/tv/src/components/settings/SettingsScreen.tsx` — player choice UI.
4. `apps/tv/DISTRIBUTION.md` — tvOS and Android beta upload runbook.
5. `apps/tv/eas.json` — EAS profiles and version increments.

## Grep These

- `nativePlayerVariant|nativeSwiftPlayerEnabled|nativePlayerDefaultVersion`
- `shouldUseNativeSwiftPlayer|Native A — AVKit Controls`
- `altool|eas submit|internal testing`

## What To Build

Default Native A on Apple TV and migrate legacy default selections once. Retain explicit post-migration Existing and Native B choices, and retain Android's current native default. Build and upload separate tvOS and Android TV beta artifacts.

## Constraints

- No production release track or Railway production deploy.
- Do not use `eas submit` for tvOS.
- Do not print credentials or bundle private keys into source.
- Keep feedback and Play device-targeting behavior intact.

## Verification

- Preferences/player tests, TypeScript, lint, and builds pass.
- tvOS IPA validates as `appletvos`, uploads, and appears in TestFlight.
- Android AAB uploads to Google Play internal testing with TV-only device coverage.
- Record processing/review/tester access separately from upload success.
