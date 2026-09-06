---
id: "feat-387"
title: "Profile-conditioned directional co-watch"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 8
depends_on:
  - "feat-369"
  - "feat-376"
  - "feat-382"
  - "feat-383"
  - "feat-386"
blocks:
  - "feat-448"
tags:
  - "admin"
  - "recommendations"
  - "cowatch"
  - "profiles"
  - "candidates"
---

## Problem

Directional co-watch should learn trustworthy ordered transitions while using the viewer’s active interests to choose anchors, not to rewrite the population graph.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U20 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `co-watch|cowatch|edge`
- `directional|anchor`
- `lift|shrinkage|distinct viewer`

## What To Build

- Write one exact contribution per distinct integrity-eligible finalized outcome revision.
- Publish immutable directional edge generations with bounded gaps, session/pair deduplication, recency decay, quality weight, distinct-viewer support, shrinkage, confidence, and popularity-corrected lift.
- Publish a reusable versioned co-watch feature contract for candidate generation, the deterministic/learned rankers, and a future item representation. At minimum carry support, confidence, popularity-corrected lift, recency weight, quality weight, and projection generation without requiring consumers to read raw edge contributions.
- Keep population edges inspectable; use session/profile interests only to select anchors and provide rank features.
- Run the generator in shadow and record a terminal decision.

## Admin Evidence Gate

- Show A-to-B and B-to-A evidence, support, lift, confidence, decay, contamination, chosen anchors, candidate overlap, and terminal decision.
- Show exact replacement after outcome revision or privacy deletion and prove the published graph matches a fresh rebuild.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Repeated plays and one manipulator cannot manufacture an edge.
- Sparse or low-confidence edges fall back to semantic candidates.
- Profile conditioning selects anchors; it does not hide or mutate population edge evidence.
- The co-watch projection owns behavioral relationship truth; a later item tower may consume its published features but cannot redefine, mutate, or become the authority for the population graph.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test directionality, deduplication, global-popularity correction, revision replacement, manipulation, sparse fallback, deletion, and rebuild equivalence.
- Test feature-contract version compatibility, missing/stale generation behavior, and identical values across generator, ranker, and representation consumers.
- Benchmark projection and generator latency/coverage.
- Reconcile edges, anchors, candidates, and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
