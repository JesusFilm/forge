---
id: "feat-393"
title: "Recommendation slate composer"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 5
depends_on:
  - "feat-382"
  - "feat-383"
  - "feat-388"
blocks:
  - "feat-394"
  - "feat-395"
  - "feat-449"
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
- Keep the contract scoped to one ranked list or row. Publish its inputs, output, constraints, and explanations for reuse by a later page orchestrator without selecting or ordering rows here.
- Preserve fixed editorial order, pins, and approved-pool semantics.
- Record every removal, movement, pin, fallback, and policy version.
- Evaluate composition policies in shadow and record a terminal decision before controlled exposure.

## Admin Evidence Gate

- Show pre/post order, removals, pins, duplicate handling, diversity, source/interest coverage, repetition, fallback, latency, and terminal decision.
- Allow an operator to explain why each final position differs from item rank.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Composition happens after item ranking and cannot redefine eligibility or experiment objectives.
- This ticket cannot absorb row eligibility, row ordering, cross-row deduplication, page budgets, or page-level exposure; those belong to `feat-449`.
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

## September 15 implementation

`apps/admin/src/services/recommendations/shadow-evaluation/slate-composer.ts`
implements `source-interest-theme-mmr-shadow-v1`, bounded to 64 candidates and six
positions. The existing shadow projection records pre/post composition, named
scalar explanations and a separate pending composition decision. The authorized
Admin request detail exposes this evidence. Live ordering is unchanged.

See `docs/validation/feat-393-slate-shadow/verification.md` for 78 passing tests,
real-PostgreSQL provenance constraints, screenshots and local performance evidence.

This ticket remains in progress. Feat-388's published editorial adapter is absent;
historical/ignore context is not captured by current shadow generators;
series/speaker inputs and familiar/discovery calibration remain unavailable. These
are shown as missing inputs, not successful checks. A terminal composition decision
is still required before controlled exposure.

## September 16 follow-through

The shadow runner now reconstructs bounded same-session recent history strictly
before the original request, with explicit missing/retention states. Comparison
provenance and the authorized Admin view show that coverage. The candidate
evaluation decision still cannot approve the separate composition policy.
Published editorial adapters, series/speaker metadata, calibration and a terminal
composition decision remain incomplete; no live MMR policy is enabled.
