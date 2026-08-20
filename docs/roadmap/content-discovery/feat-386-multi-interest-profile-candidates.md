---
id: "feat-386"
title: "Multi-interest profile candidates"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-376"
  - "feat-378"
  - "feat-379"
  - "feat-382"
  - "feat-383"
blocks:
  - "feat-387"
  - "feat-392"
tags:
  - "admin"
  - "recommendations"
  - "profiles"
  - "candidates"
  - "shadow"
---

## Problem

A single averaged profile vector hides distinct interests and can make recommendations less relevant.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U19 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `interest|centroid|medoid`
- `profile.*candidate`
- `session vector|negative evidence`

## What To Build

- Derive bounded long-term interest centroids or medoids plus a separate short-term session vector from consent- and integrity-eligible evidence.
- Preserve explicit preferences and negative evidence independently.
- Nominate semantic ANN candidates per interest with source, interest, projection, and manifest provenance.
- Run only through shadow evaluation and record a terminal decision.

## Admin Evidence Gate

- Show interest count and stability, per-interest coverage, overlap, novelty, diversity, cohort quality, expiry, and candidate provenance.
- Show promote-to-experiment, revise, retire, or inconclusive without exposing raw viewer histories or vectors.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not average unrelated interests into one taste vector.
- No-consent viewers use session-only context; reset/delete removes future influence.
- Profile candidates remain shadow-only in this ticket.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test unrelated interests, session dominance without durable rewrite, no-consent fallback, sparse profile, explicit/negative evidence, reset, withdrawal, and deletion.
- Test projection reproducibility and generator latency/coverage.
- Reconcile interest-level candidates and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
