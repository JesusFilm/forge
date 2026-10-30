---
id: "feat-745"
title: "Assess editorial recommendation A/B feasibility"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks:
  - "feat-746"
tags:
  - "admin"
  - "web"
  - "recommendations"
  - "experiments"
---

## Problem

Determine whether imported generation `editorial-catalog-20261019-v1` can enter
private testing or a decision-grade public A/B experiment without regeneration.

## Entry Points — Read These First

1. PR #2809 and `docs/recommendations/editorial-2026-10-19/import-receipt.json`.
2. `apps/admin/src/services/recommendations/precomputed/visit-admission.ts`.
3. `apps/admin/src/services/recommendations/precomputed/live-readiness.ts` and
   `public-control.ts` in the same directory.
4. `docs/operations/precomputed-public-control.md` and
   `docs/operations/precomputed-ctr-report.md`.

## Grep These

`actual_catalog_build_unverified`, `configurePrivatePrecomputedExperiment`,
`live_verified`, `final_calibration_pending`, `content_only`.

## What To Build

Write `docs/reports/2026-10-20-editorial-recommendation-ab-feasibility.md` with
primary-source references, separate private/public conclusions, launch gaps,
measurement requirements, and a concrete next step. Inspect current remote main
and PR source because the shared checkout predates the imported generation.

## Constraints

- Assessment only; do not activate an experiment or mutate production.
- Preserve unrelated working-tree changes.
- Distinguish committed readback receipts from fresh production observations.
- Do not require regeneration or invent model provenance for editorial data.

## Verification

- Check current PR metadata and code paths for private admission and public start.
- Run the artifact validator and a pure live-readiness gate probe.
- Format-check the assessment and roadmap changes.

## Completion evidence

The assessment records current main and PR sources, a passing offline artifact
validation, a deterministic editorial public-gate rejection, and authenticated
production Admin observations. The import is complete, but no private test or
baseline is configured, public serving remains incumbent version 1, and public
launch lists seven unresolved reasons. Private creation is unavailable in the
current UI. `feat-746` tracks implementation and operator preparation; no
experiment or production configuration was changed.
