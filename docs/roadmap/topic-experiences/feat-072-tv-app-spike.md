---
id: "feat-072"
title: "TV App — Expo TV Toolchain Spike"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-04-10"
duration: 2
depends_on: []
blocks:
  - "feat-073"
tags:
  - "tv"
  - "mobile"
---

## Problem

Before investing in a TV app prototype, we need to verify that the Expo SDK 54 TV toolchain works end-to-end: building for Apple TV Simulator, running expo-video on tvOS, and confirming Expo Router navigates correctly with D-pad input.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — full requirements and Platform Validation section
2. `apps/mobile-v2/package.json` — current Expo SDK version and dependencies to match
3. `apps/mobile-v2/app.json` — Expo config structure to base TV config on

## Grep These

- `react-native-tvos` on npm — verify `0.81-stable` release exists
- `@react-native-tvos/config-tv` on npm — verify plugin exists and supports SDK 54
- `expo-video` in `apps/mobile-v2/` — current video configuration to replicate

## What To Build

1. Create minimal `apps/tv-spike/` Expo app (throwaway, not production scaffolding)
2. Install `react-native-tvos@0.81-stable` as npm alias for `react-native`
3. Add `@react-native-tvos/config-tv` plugin to `app.json`
4. Run `EXPO_TV=1 npx expo prebuild --clean` — verify native project generates
5. Run on Apple TV Simulator — verify app launches
6. Add a single expo-video component playing an HLS stream — verify playback works
7. Add two screens with Expo Router — verify D-pad navigation and back button work
8. Document any issues, workarounds, or version pins needed

## Constraints

- This is a throwaway spike — do NOT invest in architecture, styling, or code quality
- Do NOT add to the monorepo's CI pipeline
- If the spike fails (Expo TV doesn't work with SDK 54), document why and stop

## Verification

- Apple TV Simulator shows the spike app running
- expo-video plays an HLS stream on tvOS
- D-pad navigates between two Expo Router screens
- Back button (menu) pops the navigation stack
- Document: go/no-go decision with any required version pins or workarounds
