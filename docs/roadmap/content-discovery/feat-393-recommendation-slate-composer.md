---
id: "feat-393"
title: "Recommendation slate composer"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 5
depends_on:
  - "feat-382"
  - "feat-383"
  - "feat-388"
blocks:
  - "feat-394"
  - "feat-395"
tags:
  - "admin"
  - "recommendations"
  - "slate"
  - "diversity"
  - "editorial"
---

## Problem

Item scores alone cannot produce a good final list; Forge needs a transparent final-stage policy for diversity, coverage, repetition, and editorial intent.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U26 contract.
2. `apps/admin/src/services/recommendations/slate.ts`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `slate|compose|MMR`
- `diversity|coverage`
- `pin|fixed|repetition`

## What To Build

- Extend the minimal composer with versioned MMR-style diversity, source and interest coverage, recent-ignore suppression, repetition limits, and calibrated familiar-versus-discovery balance.
- Preserve fixed editorial order, pins, and approved-pool semantics.
- Record every removal, movement, pin, fallback, and policy version.
- Evaluate composition policies in shadow and record a terminal decision before controlled exposure.

## Admin Evidence Gate

- Show pre/post order, removals, pins, duplicate handling, diversity, source/interest coverage, repetition, fallback, latency, and terminal decision.
- Allow an operator to explain why each final position differs from item rank.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Composition happens after item ranking and cannot redefine eligibility or experiment objectives.
- Fixed editorial pins cannot be displaced by exploration or diversity.
- Sparse and failed policies use a deterministic safe fallback.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test near duplicates, series/speaker saturation, fixed order, pinned fill, sparse locale, all-filtered candidates, ignored items, deterministic fallback, and policy load failure.
- Run property tests and latency benchmarks.
- Reconcile pre/post slates and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
