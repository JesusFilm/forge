---
id: "feat-384"
title: "Recommendation experiment spine"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 7
depends_on:
  - "feat-376"
  - "feat-381"
  - "feat-383"
blocks:
  - "feat-385"
  - "feat-447"
  - "feat-394"
  - "feat-395"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "experiments"
  - "evaluation"
---

## Problem

Approved challengers need trustworthy assignment, actual exposure, outcome attribution, guardrails, and immutable evaluation before promotion.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U17 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/web/src/`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `experiment|assignment|exposure`
- `intent-to-treat|sample ratio|contamination`
- `evaluation revision|guardrail`

## What To Build

- Start with an A/A experiment between behaviorally equivalent semantic manifests.
- Add sticky eligible assignment, signed assignment context, actual-exposure attribution, sample-ratio and contamination checks, and versioned multi-outcome evaluation.
- Use intent-to-treat as the primary estimate and exposed-only analysis as secondary.
- Append immutable evaluation revisions with uncertainty, guardrails, closed event-time windows, watermarks, and pass/fail/inconclusive/data-unhealthy states.

## Admin Evidence Gate

- Reconcile assignment, probability, actual exposure, mature outcomes, evaluation revision, uncertainty, guardrails, sample ratio, and contamination.
- Show assigned-but-not-exposed viewers in intent-to-treat and link every result to its manifest and input watermark.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Assignment is immutable for its declared unit; duplicate exposure cannot spend probability twice.
- Automated decisions wait for closed outcome windows and complete ingestion watermarks; fast operational guardrails may halt traffic earlier.
- Machine traffic is excluded from human experiments.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test concurrent assignment, never-exposed assignment, duplicate exposure, cross-device/session stickiness, sample mismatch, late outcomes, conflicting outcomes, deletion, missing instrumentation, and machine exclusion.
- Run real database uniqueness and mutation tests plus static-route cache-bypass tests.
- Reconcile assignment-to-evaluation in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`; `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
