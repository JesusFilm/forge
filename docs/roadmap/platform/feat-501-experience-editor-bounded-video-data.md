---
id: "feat-501"
title: "Bound experience editor video data and load languages on demand"
owner: "vlad"
priority: "P0"
status: "complete"
start_date: "2026-09-14"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "performance"
  - "experiences"
  - "database"
---

## Problem

The homepage editor eagerly loads all referenced videos' dubs and nested language
relations. The September 14 update increased referenced-video dubs from 4,344 to
143,030; Admin memory and latency rose sharply during the editing workflow.
The bounded replacement and isolated performance proof are complete.

## Entry Points — Read These First

1. `docs/plans/2026-09-14-001-fix-experience-editor-dub-fanout-plan.md` — PR 1,
   behavior constraints, baseline, acceptance budgets, and release checks.
2. `apps/admin/src/app/dashboard/live-data.ts` — broad row/dub projection.
3. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — initial and action loaders.
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — selected dub and picker.
5. `docs/solutions/performance-issues/watch-selected-dub-projection-20260624.md` — batching precedent.

## Grep These

`loadVideoRows`, `loadVideoRowSlice`, `playableDubs`, `preferredPickerDub`,
`selectedPlayableDubForVideo`, `SearchableVideoDubControl`.

## What To Build

Service-owned compact summaries with batched winner selection/counts; authenticated
single-video paginated language lookup; lazy picker loading with preserved saved
selection, error/retry states, stale-response guards, and bounded cache. Apply the
compact contract to top-ups, collection/search paths, and action rerenders.

## Constraints

Keep authored references and existing playback eligibility/fallback behavior.
Keep pool budgets at 10/5; avoid per-video query fanout and cross-app imports.
No production load tests or deployment shortcuts. Cache narrowing is `feat-502`.

## Verification

The plan's real-Postgres, component, production-build browser, and concurrent
performance matrix is recorded in `docs/validation/feat-501/`. Focused and full
Admin tests, lint, typecheck, and the production build pass.

## Validation status

The reusable HTTP/RSS/SQL probe, frozen measurement contract, and completed
baseline/fixed evidence are documented in `docs/validation/feat-501/README.md`.
The incident fixture passed the payload, memory, repeated-use, collection,
public-latency, failure, and pool-timeout gates on the recorded fixed revision.
