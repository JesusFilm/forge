---
id: "feat-394"
title: "Bounded recommendation exploration"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-384"
  - "feat-385"
  - "feat-393"
blocks:
  - "feat-395"
  - "feat-396"
  - "feat-448"
tags:
  - "admin"
  - "watch"
  - "recommendations"
  - "exploration"
  - "experiments"
---

## Problem

Eligible underexposed candidates need limited randomized exposure so Forge can learn without escaping integrity, product, or editorial guardrails.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U28 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `exploration|propensity|probability`
- `exposure cap|budget|holdout`
- `underexposed`

## What To Build

- Add one eligible exploration slot after integrity, eligibility, and slate-policy checks.
- Log the randomized decision point, available actions, selected action and position probabilities, candidate-set digest, policy/manifest versions, caps, holdout, and fallback.
- Enforce exposure budgets and guardrails through the experiment and rollback spine.
- Evaluate exploration outcomes and long-tail coverage without claiming correction for upstream candidate-generation bias.

## Admin Evidence Gate

- Show budget, cap use, action and position probabilities, long-tail coverage, outcomes, integrity, guardrails, holdout, fallback, and terminal decision.
- Show exactly which decision point was randomized and label upstream candidate selection as observationally biased.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Exploration cannot displace fixed editorial pins, redefine objectives, promote itself, or bypass eligibility.
- Missing propensity or candidate-set evidence invalidates bias-aware evaluation.
- All exposure remains inside pre-approved stages with automatic rollback.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test cap exhaustion, zero-probability control, ineligible items, integrity anomaly, guardrail failure, offline replay, fallback, missing propensity, and rollback.
- Run probability, cap, assignment, holdout, and bias-aware evaluation fixtures.
- Reconcile every randomized action and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
