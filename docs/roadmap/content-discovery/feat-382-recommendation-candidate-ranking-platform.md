---
id: "feat-382"
title: "Recommendation candidate and deterministic ranking platform"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 7
depends_on:
  - "feat-368"
  - "feat-376"
  - "feat-381"
blocks:
  - "feat-383"
  - "feat-386"
  - "feat-387"
  - "feat-388"
  - "feat-389"
  - "feat-390"
  - "feat-391"
  - "feat-392"
  - "feat-393"
tags:
  - "admin"
  - "recommendations"
  - "candidates"
  - "ranking"
  - "semantic"
---

## Problem

Forge needs one complete semantic-parity path through nomination, union, eligibility, ranking, and minimal composition before adding more generators.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U15 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/services/watchability`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `sceneRecommendations|semantic`
- `candidate|nomination|provenance`
- `watchability|dedup`
- `ranker|RRF|slate`

## What To Build

- Define a provenance-rich candidate nomination contract and adapt the current semantic retriever to it.
- Union and canonicalize candidates, reuse watchability and locale eligibility, preserve every contributing source, and record rejection reasons.
- Normalize semantic scores, retain an RRF benchmark, apply a transparent versioned deterministic score, and compose a minimal playable deduplicated slate.
- Run semantic A/A parity through the complete path and publish a new ready semantic-control manifest with safe fallback.

## Admin Evidence Gate

- For one request, reconcile nominated, canonicalized, deduplicated, rejected, scored, ordered, and composed items with reasons and versions.
- Show candidate/eligibility parity and deterministic-ranker parity independently inside the same complete request trace.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- This is one vertical request slice, not separate horizontal infrastructure launches.
- The unit closes only when every stage is independently observable and the end-to-end semantic output remains compatible.
- Do not add non-semantic generators or learned ranking here.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Run contract, module, watchability, canonical-deduplication, eligibility, deterministic-tie, score, slate, fallback, and manifest tests.
- Benchmark complete-service latency and payload size and compare before/after semantic candidates.
- Reconcile per-stage counts and item explanations in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
