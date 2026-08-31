---
id: "feat-383"
title: "Shadow candidate evaluation"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: ""
duration: 5
depends_on:
  - "feat-376"
  - "feat-381"
  - "feat-382"
blocks:
  - "feat-384"
  - "feat-386"
  - "feat-387"
  - "feat-388"
  - "feat-389"
  - "feat-390"
  - "feat-391"
  - "feat-392"
  - "feat-393"
  - "feat-448"
tags:
  - "admin"
  - "recommendations"
  - "candidates"
  - "shadow"
  - "evaluation"
---

## Problem

New candidate generators need a reusable counterfactual evaluation path that cannot change the live semantic slate.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U16 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `shadow|candidateRun`
- `overlap|novelty|coverage`
- `terminal decision|inconclusive`

## What To Build

- Run any generator against sampled live contexts through the same nomination and eligibility contract without exposing its output.
- Persist bounded nominations with sampling, projection, eligibility, retention, privacy-generation, and manifest references, excluding raw queries and profile vectors.
- Aggregate coverage, overlap, novelty, diversity, rejection, latency, and cohort quality.
- Record promote-to-experiment, revise, retire, or inconclusive with a reason and reevaluation condition.

## Admin Evidence Gate

- Show live-versus-shadow overlap, contribution, eligibility rejection, coverage, diversity, latency, cohort quality, and input freshness.
- Show the immutable terminal decision and prove shadow output never changed a live request.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Shadow runs are side-effect-free for viewer ordering, assignments, and live strategy.
- Store bounded provenance and version references, not raw viewer context.
- A decision to experiment creates a later controlled-exposure ticket; it does not authorize exposure here.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test live/shadow isolation, multiple-source provenance, low coverage, inconclusive state, workflow fencing, deleted context, retention, and replay.
- Recompute aggregates from pinned inputs.
- Reconcile generator runs and decisions in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
