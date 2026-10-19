---
id: "feat-751"
title: "Opt-in native public Top Shelf feed"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [tv, tvos, top-shelf, native, cache]
---

## Problem

The current extension reads the app snapshot only; changing API content while
Watch is closed cannot be observed until the main app fetches again. The owner
authorized a local-only native fetching prototype after feat-750 fixed foreground
freshness. Push remains excluded.

## Entry Points

- `apps/tv/top-shelf/ContentProvider.swift`
- `apps/tv/top-shelf/TopShelfFeed.swift`
- `apps/tv/plugins/withTopShelf.js`
- `apps/tv/scripts/topShelf.test.js`
- `docs/plans/2026-10-20-top-shelf-native-public-feed.md`
- `docs/tv-system-home-validation-2026-10-02.md`

## Constraints and Verification

Opt-in public feed only, strict response bounds and simulator-only local HTTP;
Release must not retain local endpoint/ATS overrides. Keep Continue/history and
the app-owned snapshot untouched. Public cache needs explicit empty/error,
expiry/revision/context handling and coordinated writes. Verify actual system Home
plus native/local request evidence while the main app remains stopped; do not
infer visible placement from successful fetch/build alone. No production API,
admin mutation, Push test, deployment or store readiness claim.

## Result

The scoped local prototype is implemented and verified on
`codex/tv-selected-improvements` without publishing. Corrected provider `d3b4904d`
and helper `82307dd8` pass native Debug build, six closed-app UI checks and passive
artwork refresh after137.461 seconds in one200.754-second observation. TV static
checks,19 Foundation regressions and8 fixture-server checks pass. The unwanted
native availability countdown was repaired and title/passive behavior retested.
See the linked validation record for earlier candidates, final source binding,
silent captioned video, ownership evidence, cleanup and limits. Production feed,
physical-device and store readiness remain separate feat-630 gates; no Push tested.
