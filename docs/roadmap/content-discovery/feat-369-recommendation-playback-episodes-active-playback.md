---
id: "feat-369"
title: "Recommendation playback episodes and active-playback proxy"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-368"
blocks:
  - "feat-370"
  - "feat-371"
  - "feat-372"
  - "feat-375"
  - "feat-376"
  - "feat-378"
  - "feat-380"
  - "feat-381"
  - "feat-387"
  - "feat-390"
  - "feat-391"
  - "feat-392"
  - "feat-448"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "playback"
  - "telemetry"
---

## Problem

Playback must be represented as recomputable episodes so elapsed time, player position, and observable foreground playback are not mistaken for cognitive attention.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U2 contract.
2. `apps/web/src/components/watch/WatchEventRecorder.tsx`
3. `apps/web/src/components/watch/`
4. `apps/admin/src/workflows/`
5. `apps/admin/prisma/schema.prisma`

## Grep These

- `WatchEventRecorder|timeupdate|visibilitychange`
- `playback|episode|finalize`
- `legacy-position-v0|active-watch-proxy-v1`

## What To Build

- Issue a source-neutral server playback context for every eligible Watch arrival, optionally linked to recommendation, search, share, or acquisition provenance, then exchange it for an episode-scoped token.
- Record immutable playback facts, union foreground-playing intervals, and finalize episodes through a fenced idempotent workflow.
- Publish revisioned outcomes with exact input watermarks and compare the legacy rule with active-watch-proxy-v1 by duration cohort.
- Publish consent- and integrity-eligible finalized outcomes as source-neutral preference evidence regardless of whether the viewer arrived through recommendations, search, direct navigation, a shared link, or editorial discovery; retain discovery source as provenance, never as the gate for profile eligibility.
- Record a per-proxy Admin readiness decision without making the proxy live ranking input.

## Admin Evidence Gate

- Show active-time distributions, finalization lag, late revisions, missingness, duration cohorts, and legacy-versus-proxy sensitivity.
- Direct, Google, shared-link, search, and recommendation arrivals all produce episodes without fabricated recommendation attribution.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- The measure is an observable active-playback proxy, not attention, satisfaction, or universal meaningful-watch truth.
- Late evidence supersedes prior outcome revisions; it never mutates history or double-counts intervals.
- Discovery source may affect analysis and rank features, but equivalent finalized outcomes must use the same profile-eligibility policy across sources.
- The readiness decision is eligible-for-shadow-evaluation, revise, retire, or inconclusive—not live promotion.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test route exit, cleanup, long watches, late batches, overlapping intervals, seeking, background playback, token misuse, and racing finalizers.
- Rebuild the projection from immutable facts and prove it matches the incremental result.
- Reconcile representative episodes and classifier revisions in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
