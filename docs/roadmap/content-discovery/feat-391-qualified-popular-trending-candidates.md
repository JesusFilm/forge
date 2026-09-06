---
id: "feat-391"
title: "Qualified popular and trending candidates"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 5
depends_on:
  - "feat-369"
  - "feat-370"
  - "feat-372"
  - "feat-376"
  - "feat-382"
  - "feat-383"
blocks:
  - "feat-392"
  - "feat-449"
tags:
  - "admin"
  - "recommendations"
  - "popular"
  - "trending"
  - "candidates"
---

## Problem

Popularity must be based on integrity-eligible, quality-weighted outcomes rather than raw play counts.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U24 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `popular|trending|rising`
- `decay|window|distinct viewer`
- `contribution|concentration`

## What To Build

- Write one exact contribution per eligible outcome revision and aggregation window.
- Publish immutable popular, rising, and trending generations by locale and surface using distinct viewers, playback quality, mission outcomes, freshness, decay, support, and concentration caps.
- Correct technical QoE failure and preserve separate reason provenance for popular, rising, and trending.
- Run the generator in shadow and record a terminal decision.

## Admin Evidence Gate

- Show support, window, decay, concentration, quality components, locale/surface scope, overlap, contamination, and terminal decision.
- Prove revisions, eligibility reversals, and deletion replace exact contributions and match a fresh rebuild.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Raw plays, bots, and one viral item cannot dominate the projection.
- Low-support segments use a declared fallback rather than unstable rankings.
- No generated list is published to Watch from this ticket.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test bot exclusion, concentration caps, locale trend, low traffic, insufficient support, replay, revised outcomes, eligibility reversal, deletion, QoE correction, and late outcomes.
- Run aggregation math, rebuild-equivalence, integrity, erasure, and generator benchmark tests.
- Reconcile generations and decisions in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
