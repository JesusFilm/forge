---
id: "feat-611"
title: "Resolve Android dependencies in Renovate"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-06"
duration: 1
depends_on: []
blocks: []
tags:
  - infrastructure
  - tv
---

## Problem

Mend Renovate reports `no-result` for seven AndroidX and Play Integrity packages in the TV Expo modules. Their module Gradle files inherit repositories from the generated Android project, which Renovate cannot discover from the tracked module files.

## Entry Points — Read These First

1. `renovate.json`: Maven datasource rule scoped to AndroidX and Google Play groups.
2. `apps/tv/modules/native-android-player/android/build.gradle`: Activity, Core and Media3 coordinates.
3. `apps/tv/modules/tv-feedback-integrity/android/build.gradle`: Play Integrity coordinate.

## Grep These

- `androidx.activity:activity`
- `androidx.media3:media3-session`
- `com.google.android.play:integrity`

## What To Build

Configure Google Maven only for these package groups. Preserve all other datasources, registry choices, package versions and lockfiles.

## Constraints

No package upgrades, generated Android project changes, authentication changes or deployment steps. Preserve disabled dependency automerge.

## Verification

- Renovate 44.138.0 strict repository config validation passes.
- Public Maven metadata probes reproduce 404 at Maven Central and 200 with valid versions at Google Maven for Activity, Media3 Session and Play Integrity.
- Probe all seven affected packages and confirm their currently pinned versions exist at Google Maven.
- Prettier and `git diff --check` pass for the changed files.
- Request a hosted scan after integration and confirm the seven lookup warnings disappear. Hosted verification remains a follow-up until this PR is integrated.

Registry source: <https://docs.renovatebot.com/java/#custom-registry-support-and-authentication>.
