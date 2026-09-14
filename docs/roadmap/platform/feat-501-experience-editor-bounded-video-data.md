---
id: "feat-501"
title: "Bound experience editor video data and load languages on demand"
owner: "vlad"
priority: "P0"
status: "not-started"
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
Query expansion is verified; isolated performance reproduction remains required.

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

Follow the plan's real-Postgres, component, production-build browser, and concurrent
performance matrix; store results in `docs/validation/feat-501/`. Run focused Admin
tests, lint, typecheck, and build. Planning is complete; implementation is pending.
