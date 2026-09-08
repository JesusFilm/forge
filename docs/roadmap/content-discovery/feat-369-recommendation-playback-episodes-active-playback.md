---
id: "feat-369"
title: "Recommendation playback episodes and active-playback proxy"
owner: "nisal"
priority: "P0"
status: "complete"
completed_date: "2026-09-07"
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
  - "feat-464"
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
- Publish finalized outcomes through a stable source-neutral consumer boundary regardless of whether the viewer arrived through recommendations, search, direct navigation, a shared link, acquisition, or editorial discovery; retain discovery source as provenance. Downstream consumers—not playback collection—own consent, integrity, privacy, and preference-eligibility policy.
- Record a per-proxy Admin readiness decision without making the proxy live ranking input.

## Admin Evidence Gate

- Show active-time distributions, finalization lag, late revisions, missingness, duration cohorts, and legacy-versus-proxy sensitivity.
- Direct, Google, shared-link, search, and recommendation arrivals all produce episodes without fabricated recommendation attribution.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- The measure is an observable active-playback proxy, not attention, satisfaction, or universal meaningful-watch truth.
- Late evidence supersedes prior outcome revisions; it never mutates history or double-counts intervals.
- Discovery source may affect later analysis and rank features, but the playback episode pipeline must process equivalent outcomes identically across sources and consent states.
- The readiness decision is eligible-for-shadow-evaluation, revise, retire, or inconclusive—not live promotion.
- Do not add consent branching, consent UI, recommendation-specific privacy schema, recommendation eligibility gates, erasure workflows, retention machinery, or a new privacy-review gate in this ticket. Any downstream recommendation consumer owns those policies at its ingestion boundary.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test route exit, cleanup, short and long watches, late and reordered batches, overlapping and duplicate intervals, seeking, hidden/background playback, invalid/expired/replayed/cross-session tokens, racing finalizers, stale fences, supersession, source equivalence with distinct provenance, consent-state-identical processing, and fail-open playback when telemetry is unavailable.
- Rebuild the projection from immutable facts and prove it matches the incremental result.
- Reconcile representative episodes and classifier revisions in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.

## Completion Evidence

- PR #2155 shipped source-neutral episodes, append-only facts, revisioned outcomes, Admin reconciliation, source-equivalence coverage, and a browser-proven Watch-to-Admin lifecycle while keeping `active-watch-proxy-v1` out of live ranking.
- PR #2165 made selection attribution and playback delivery replay-safe, including stable claim nonces, immutable delivery receipts, exact-event idempotency, payload-conflict detection, and fail-open playback.
- The 2026-09-07 post-deploy audit confirmed active production collection and exposed the remaining replay-receipt collision and cookie-less session-binding race instead of silently accepting corrupt evidence.
- The closeout hotfix reserves replay ordinals through the episode row before immutable receipt insertion, serializes every session-creating browser request even without Web Locks, and stops retrying definitive invalid bindings. Privacy-safe reason codes make every rejected binding reconcilable without exposing episode, media, or session identifiers.
- The deterministic real-PostgreSQL concurrency regression, the focused playback/route/recorder suites, both application typechecks and lints, and the full Admin and Web suites pass.
