---
id: "feat-381"
title: "Semantic recommendation control readiness"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 4
depends_on:
  - "feat-368"
  - "feat-369"
  - "feat-372"
  - "feat-376"
  - "feat-459"
blocks:
  - "feat-382"
  - "feat-383"
  - "feat-384"
tags:
  - "admin"
  - "recommendations"
  - "semantic"
  - "evaluation"
  - "readiness"
---

## Problem

The semantic-only production path must be demonstrably healthy before it can serve as the control for later experiments.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U14 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `semantic.*control|baseline|readiness`
- `inconclusive|data-unhealthy`
- `watermark|evaluation`

## What To Build

- Define the surface-specific semantic control, evidence window, minimum-data rule, uncertainty handling, operational outcomes, mission outcomes, and guardrails.
- Compute ready, not-ready, inconclusive, or data-unhealthy from delivery, attribution, outcome maturity, and policy behavior.
- Keep this as a readiness decision; do not claim semantic recommendations add incremental viewer value without a comparator.
- Persist the exact input window, watermarks, policy versions, and explanation in Admin.

## Admin Evidence Gate

- Show control health, evidence maturity, attribution quality, outcome vector, uncertainty, guardrails, and the readiness state with reasons.
- Differentiate low traffic, insufficient mature outcomes, and broken instrumentation.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Semantic remains the live control; this ticket does not add a challenger.
- CTR cannot pass the control when qualified outcomes or guardrails materially regress under the declared policy.
- Machine evidence is excluded from human control readiness.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test low traffic, attribution mismatch, immature outcomes, CTR/quality conflict, mission-action policy, machine exclusion, late evidence, and workflow fencing.
- Recompute evaluations deterministically from pinned inputs.
- Reconcile input rows and readiness explanations in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
