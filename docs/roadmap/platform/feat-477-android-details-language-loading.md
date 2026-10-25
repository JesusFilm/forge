---
id: "feat-477"
title: "Android TV details language and subtitle loading feedback"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-09-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "android-tv"
  - "loading"
  - "ux"
---

## Problem

Home → JESUS → See more displays language/subtitle controls before the details
request completes. Language opens an empty list and unfinished metadata appears
as a final state. Preparing the closed language panel also sorts and validates
thousands of rows during details loading.

## What To Build

- Keep Language and Subtitles buttons available while metadata downloads.
- Hide language names/counts and subtitle state until the current details data
  is ready. Opening either menu early shows an indeterminate spinner and a clear
  loading label, not an empty picker or invented percentage.
- Replace loading with available options automatically. Keep Close/Back usable
  during loading/error; offer retry after a failed fetch.
- On Android, prepare language rows only while the panel is open and data ready.
- Preserve Apple TV behavior, existing player code, and unrelated worktree edits.

## Entry Points

- `apps/tv/app/watch/[slug].tsx` — current-video query state and menu wiring.
- `apps/tv/src/components/watch/LanguagePanel.tsx` and `SubtitlePanel.tsx`.
- `apps/tv/src/components/watch/DetailsActionRow.tsx` — secondary labels.
- `apps/tv/src/components/watch/panelState.ts` — pure state/row preparation.

## Verification

- Pure loading/error/ready and hidden-panel row-preparation tests.
- Typecheck, lint, TV test suite, Android release build, diff/format checks.
- Physical Chromecast: open each menu before metadata resolves, inspect spinner,
  Close/Back, automatic options, and ready labels. Compare closed-panel work and
  request behavior; do not claim the full metadata request became smaller.

## Progress — 2026-09-05

- Implemented Android-only details readiness, hidden unfinished labels/counts,
  loading spinners, error/retry states, and deferred closed language preparation.
- Typecheck, lint, release build, 126 suites / 1,861 tests, and diff check pass.
- Physical Chromecast and emulator captured Audio Language loading with the
  indicator and Close visible. Back dismissal and loaded subtitle options were
  exercised; a pending subtitle-spinner capture is still outstanding.
- Emulator network delay was temporarily set for testing and restored to zero.
- No request/schema change or persistent details cache has been added. The user
  subsequently asked about on-device caching; Home already persists a bounded
  snapshot, while details currently use only Apollo's in-memory cache.
