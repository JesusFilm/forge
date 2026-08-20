---
id: "feat-395"
title: "Learned multi-outcome re-ranker"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: ""
duration: 10
depends_on:
  - "feat-380"
  - "feat-384"
  - "feat-385"
  - "feat-393"
  - "feat-394"
blocks:
  - "feat-396"
tags:
  - "admin"
  - "recommendations"
  - "ranking"
  - "machine-learning"
  - "evaluation"
---

## Problem

After trustworthy exposure and outcome evidence exists, Forge can evaluate an interpretable learned challenger without replacing the deterministic control or collapsing outcomes.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U27 contract.
2. `apps/admin/src/services/recommendations/rankers/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `ranker|model registry`
- `feature definition|training snapshot`
- `calibration|propensity`

## What To Build

- Record an implementation decision for the smallest reproducible training and inference stack, model format, artifact store, registry, and repository command before model code begins.
- Build point-in-time train, validation, and test snapshots with exact feature, outcome, policy, code, eligibility, privacy-cutoff, and exploration-propensity lineage.
- Train an interpretable logistic-regression or gradient-boosted-tree challenger with separate calibrated outcome targets combined only by explicit surface policy.
- Publish model artifacts atomically, serve through a versioned adapter, retain the deterministic ranker as control/fallback, and evaluate in shadow before any new exposure ticket.

## Admin Evidence Gate

- Show feature health, snapshot lineage, leakage checks, per-outcome calibration, cohort performance, shadow comparison, model version, fallback use, and terminal decision.
- Label correction as valid only at logged randomized decision points; do not claim end-to-end unbiased learning.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Training and serving share one versioned feature definition.
- Deletion blocks future snapshot inclusion; model revocation behavior is explicit in the manifest’s privacy policy.
- Model failure or stale artifacts fall back to the deterministic ranker.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test target leakage, point-in-time joins, missing features, stale/model-load failure, calibration drift, cohort regression, deletion, artifact reproducibility, and deterministic fallback.
- Run offline calibration and ranking metrics by outcome and cohort plus serving latency tests.
- Reconcile model lineage, shadow evidence, and decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
