---
id: "feat-748"
title: "Preserve TV development launcher startup across prebuilds"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-14"
duration: 1
depends_on: []
blocks: []
tags: [tv, tvos, expo, startup]
---

## Problem

Expo SDK 54's development launcher requires an app window during
`application(_:didFinishLaunchingWithOptions:)`. The TV scene plugin delays
window creation until scene connection, so a freshly generated Debug build
crashes with `Cannot find the keyWindow`. The local generated AppDelegate
workaround is overwritten by prebuild.

## Entry Points — Read These First

- `apps/tv/plugins/withTVSceneLifecycle.js`: generated AppDelegate startup patch.
- `apps/tv/plugins/scene-lifecycle/ForgeSceneDelegate.swift`: existing window
  attachment and scene-owned Release startup.
- `apps/tv/plugins/withTVSceneLifecycle.test.js`: startup and link regressions.

## Grep These

`forgeLaunchOptions|startReactNative|existingWindow|didFinishLaunchingWithOptions`

## What To Build

Persist the verified Debug startup workaround in the config plugin: construct
the window and start the React factory before calling Expo's launch subscribers.
Reuse that window during scene connection and clear retained launch options.
Keep Release startup in the scene delegate. Cover both startup orders and
preserve URL, universal-link and lifecycle forwarding.

## Constraints

No dependency upgrades, other app changes or public deployment. Native `ios/`
files are generated and ignored; the durable fix belongs in the config plugin.

## Verification

Run scene plugin regression tests, scoped lint and formatting. Regenerate the
native project from the corrected plugin, build Debug for tvOS simulator, and
verify a cold launch survives with Home content and no new crash report.
Check generated Release startup excludes the early Debug window.

October 14: all 10 scene lifecycle regression tests, scoped ESLint and formatting
passed. A clean Expo prebuild generated the Debug initialization automatically;
the regenerated tvOS Debug build succeeded. Installed on the tvOS 27 Apple TV
4K simulator and verified a fresh boot/launch reached populated Home with a
connected React bridge and no new crash report. Home was visible at 13 seconds
of process uptime; the prior generated workaround showed its intro at 11 seconds
and populated Home at the later 30-second sample. These are bounded startup smoke
samples, not a precise first-render benchmark. Release startup ordering is covered
by the generated-code regression; no Release or physical-device build was needed
for this development launcher fix.

The local restart helper also separates app termination from launch by two
seconds: PineBoard logs showed its queued Home transition could otherwise
background a successfully relaunched app. Source review found no actionable
regressions. The durable startup requirement is documented in
`apps/tv/CLAUDE.md`.
