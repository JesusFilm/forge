---
id: "feat-479"
title: "Android startup and details loading with safe native focus"
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
  - "loading"
  - "focus"
---

## Problem

Cold Home and unready movie details look inert. Details exposes actions while
metadata/focus is unsettled, leading to invisible focus and unintended presses.

## What To Build

- Android Home with no usable model: labeled progress, one native-focused Back
  action. Cached usable content is not blocked by background revalidation.
- Android details pending metadata/preferences: hide movie actions; show labeled
  progress with a native-focused Back action. Cancel closes the route, while
  normal completion closes only the loading UI. Handle retryable errors separately.
- Show progress on autoplay preparation and do not expose an inert Play button
  when there is no playable source. Preserve Apple TV behavior.
- Scope native loading dialogs by request id and route focus; cancel on unmount.
- No data-cache, backend, playback-engine, or unrelated Google TV changes.

- Native pre-React startup overlay: Starting app, animated progress, and Back
  handled directly by Android until the React root mounts. An idempotent Expo
  MainActivity config plugin reproduces this on managed prebuilds.

## Verification

- Unit-test loading versus ready/unavailable states, cancellation, late callbacks,
  and cached Home revalidation behavior.
- Typecheck, lint, TV suite, Android release build, format/diff checks.
- Chromecast/emulator: cold entry, early D-pad/Select, visible loading/Back focus,
  Back cancellation, automatic ready transition, and no hidden movie actions.

## Result — 2026-09-05

- Physical Chromecast showed Starting app before React rendered, then handed
  focus to Home's Search button. Early Down/Right/Select exited safely via Back.
- Cold movie-details recording showed native progress and a white-focused Back
  row, without movie actions. UIAutomator confirmed the native ListView owned
  focus; the recorded screen transitioned to ready details with Play focused.
- Early details Down/Right/Select returned to Home without starting playback.
- Cached Home remained usable. No new fetches/cache writes or bulk processing
  were introduced; startup smoke timings remained in the prior range (2057 ms
  install-first cold launch, 897 ms subsequent cold launch), not a controlled
  throughput or speed-improvement claim.
- Typecheck, lint, 129 suites / 1,875 tests, release build, and diff check pass.
- Existing app-resolved AndroidX Activity 1.9.0 and Core 1.15.0 are declared on
  the native library for startup Back handling; app runtime versions unchanged.
- APK SHA-256: `bcb67fbec8a7fe372634238139018e64b75c6cff78589af2f07bf9e73337e24c`.
- Evidence: `test-results/android-loading-safety-2026-09-05/`.
- Installed on Chromecast locally. Apple TV unchanged; no commit or publication.
