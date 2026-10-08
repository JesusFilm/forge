---
id: "feat-603"
title: "Five-concept TV system Home rotation"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-02"
duration: 7
depends_on: []
blocks: []
tags: [tv, tvos, android, discovery]
---

## Problem

Expose five useful content entry concepts on system Home without unstable random changes or unsupported custom OS layouts.

## Entry Points — Read These First

- `docs/plans/2026-10-02-tv-home-five-concept-rotation.md`
- Archive branch `codex/archive/2026-10-02/apple-native-top-shelf-interactive`: `apps/tv/top-shelf/ContentProvider.swift`, `apps/tv/plugins/withTopShelf.js`.
- Archive branch `codex/archive/2026-10-02/android-native-google-home`: `apps/tv/modules/google-tv-home/`.
- `apps/tv/src/lib/watchEvents/continueWatching.ts`

## Grep These

`TVTopShelfCarouselContent|TVTopShelfSectionedContent|topShelfContentDidChange|Engage|isServiceAvailable`

## What To Build

Follow the linked plan. Use native-supported mappings for spotlight, resume, collections, shorts and topic entry. Stable eligible shuffled rotation on Apple; Android policy and SDK availability take precedence over rotation. Keep implementation PRs platform-scoped.

October 7: include the requested beta-only Settings preview selector (Automatic plus five concepts), with production gating and real-content eligibility preserved. The user's physical-device install request overrides the older simulator-only restriction for this verification. Xcode/tvOS 27 scene startup compatibility is required for the local build.

## Constraints

Implementation is in progress on `codex/tv-system-home-five-concepts`. Do not merge whole archived branches, modify player layouts, share secrets with extensions, or claim Google Home publication without eligibility/availability proof. Use Apple TV simulator, not physical hardware.

## Verification

Selector tests, native prebuild, signed extension build, cold/warm deep links, real system Home display, stable focus, baseline startup timing and documented Android SDK/onboarding gates. Evidence and remaining gates are recorded in `docs/tv-system-home-validation-2026-10-02.md`.

October 8 focused Apple integration is in progress on `codex/apple-tv-top-shelf-integration`, based on main after #2070, #2610 and #2623. Source worktree remains untouched. Scope, previous-PR audit and simulator/video verification: `docs/plans/2026-10-08-apple-tv-top-shelf-integration.md`. Only the Apple TV 4K simulator is authorized for this task; older physical-device approvals above are historical.

Apple integration milestone: implemented; all five real-content styles, Automatic, native resume, cold/warm links and Search Back verified in the 4K simulator. 165 suites / 2,116 tests and Release native build passed. Matching local app/extension versions: 1.0.0 (1). Overall status remains in progress for native carousel OS action focus, signed distribution and separately scoped Android gates. The new Apple-only PR must not be treated as a completed store release.
