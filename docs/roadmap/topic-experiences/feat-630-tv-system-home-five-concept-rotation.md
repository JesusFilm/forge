---
id: "feat-630"
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

Imported from the donor's `feat-603` TV ticket. Main already assigns that ID to mobile in-app feedback; this integration uses the next globally unique ID, `feat-630`. The donor ticket and mobile ticket are unchanged.

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

## October 14 local integration

Integrated on `feat/tv-discovery-local` over current main while preserving the
latest TV players, Apple Top Shelf and development harness. Static TV checks
pass (173 suites / 2,182 tests); tvOS Debug build and Settings/Back smoke pass.
Exact native/runtime evidence, credential requirements and remaining performance
and Google TV device gates are in
`docs/plans/2026-10-14-tv-discovery-local-integration.md`.
No push, deployment or beta upload was requested or performed. Overall release
status remains in progress until the documented runtime gates are closed.

## October 19 API interception verification

The owner authorized test-only local API interception against the unchanged
selected-integration build in a separate 4K QA simulator. Cover content changes,
fallback/recovery, foreground refresh and background/terminated observations;
preserve real content identities and original simulator data. Execution and
evidence: `docs/plans/2026-10-19-top-shelf-api-interception.md`. No admin-content
edits, push implementation, release or app behavior changes are part of this run.

The authorized interception exercise is complete. Actual system Home evidence
confirms foreground content updates, filtering, error retention/recovery and real
native film destinations. Background and terminated observations each exceeded
60 seconds without a request or snapshot update. Journey copy required reopening;
Continue metadata remained cached through reopening and refreshed only after a
documented QA-only catalogue-cache reset that preserved real history. These are
verification findings, not new refresh or push implementations. See the October
19 outcome table in `docs/tv-system-home-validation-2026-10-02.md` and the local
captioned-video gallery linked from the plan. Overall feat-630 remains in progress
for its broader platform, performance, distribution and release gates.

## October 20 foreground freshness follow-up

feat-753 fixes the two application cache limits found above. Existing Continue
metadata and Journey copy now refresh on foreground return without deleting cache
or history; actual local API replay confirms artwork, order/removal and recovery.
See `docs/plans/2026-10-19-top-shelf-fresh-content.md`. The native extension remains
snapshot-only: add a bounded native content fetch with independent public cache and
revision/ownership fencing to support system-requested closed-app freshness.
The local background/terminated observations showed no refresh over 60 seconds;
Push was excluded by the owner. Overall feature/release status remains in progress.

## October 20 native public-feed prototype

feat-751 adds opt-in extension-side public fetching and a separate bounded cache.
The final local Debug build has actual native HTTP/cache/visible Journey evidence
while Watch remains stopped, including API failure, invalid data, timeout, empty
and recovery. This supersedes the snapshot-only behavior above only when the
native public feed is configured; the default remains off. Continue remains
app-owned. See the new native section in
`docs/tv-system-home-validation-2026-10-02.md` and the feat-751 plan. There is no
production feed service, admin/push integration or physical-device/store claim.
Overall feat-630 remains in progress for its broader platform/release gates.
