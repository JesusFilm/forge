---
id: "feat-392"
title: "High-satisfaction cohort candidates"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 7
depends_on:
  - "feat-369"
  - "feat-372"
  - "feat-376"
  - "feat-378"
  - "feat-380"
  - "feat-382"
  - "feat-383"
  - "feat-386"
  - "feat-391"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "cohorts"
  - "satisfaction"
  - "candidates"
---

## Problem

Similar-interest cohorts can surface valuable videos only when support, privacy, outcome quality, and popularity correction are explicit.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U25 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `cohort|similar interest`
- `satisfaction|survey`
- `minimum support|suppression`

## What To Build

- Define cohorts from consent-eligible interest generations and write exact versioned contributions.
- Require minimum distinct support and confidence; combine behavioral, mission, and reported outcomes as a visible vector rather than one opaque label.
- Correct for popularity and survey non-response, suppress unsafe or weak cohorts, and publish only aggregate immutable generations.
- Run the generator in shadow and record a terminal decision.

## Admin Evidence Gate

- Show cohort eligibility, suppression reason, support, confidence, outcome vector, survey non-response, popularity correction, overlap, and terminal decision.
- Do not expose raw membership or viewer lists; prove profile reset and deletion remove future contribution.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Small cohorts remain suppressed even when candidate quality appears high.
- Conflicting outcomes may remain inconclusive; do not collapse them to one score.
- Aggregate generations only—no raw membership snapshots in Admin or serving.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test small-cohort suppression, survey non-response, negative feedback, popularity correction, replay, revision, deletion, reset, conflicting outcomes, and fresh-rebuild equivalence.
- Run cohort privacy, math, propensity, uncertainty, latency, and coverage tests.
- Reconcile aggregate evidence and decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
