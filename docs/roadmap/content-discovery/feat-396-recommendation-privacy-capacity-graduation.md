---
id: "feat-396"
title: "Recommendation privacy and capacity graduation"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: ""
duration: 5
depends_on:
  - "feat-394"
  - "feat-395"
  - "feat-447"
  - "feat-448"
  - "feat-449"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "privacy"
  - "capacity"
  - "operations"
---

## October 2, 2026 closeout disposition

Cancelled under the owner's final recommendation-roadmap scope decision.
The umbrella graduation exercise for the retired exploration, learned models and personalized-page programme is cancelled. It is not a waiver of privacy, retention or capacity obligations: current mandatory lifecycle controls stay with their owning implementation, and the actual loaded-retention/capacity gate remains in platform feat-554 plus measured efficiency work in feat-574. No warehouse/feature-store/vector-service migration or full historical drill set is claimed.

Audit anchors: `apps/admin/src/services/recommendations/profiles/privacy.ts`, `apps/admin/src/services/recommendations/retention.service.ts`, `docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`, `docs/roadmap/platform/feat-574-recommendation-storage-efficiency.md`.
The audit establishes the current scope and code boundaries, not new production
verification. See [the consolidated closeout record](../../reports/2026-10-02-recommendation-roadmap-closeout.md)
for owner, PR, evidence and remaining operational work. The requirements below
are historical and do not authorize new implementation.

## Historical problem

Forge should adopt specialized recommendation infrastructure only when lifecycle drills and measured bottlenecks show a concrete job for it.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U29 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`
5. `docs/operations/`

## Grep These

- `retention|erase|delete`
- `backlog|capacity|latency|storage growth`
- `feature store|warehouse|vector`

## What To Build

- Run end-to-end access, personalization-disable, erasure, projection rebuild, workflow recovery, cache rollback, full-corpus retrieval, ingestion/load, storage-growth, and complete-service latency exercises.
- Review formal lifecycle and capacity checkpoints from after playback episodes, profiles, and promotion.
- Attribute every breach to a measured bottleneck and record retain, optimize, or split decisions for queues, warehouse, feature store, or vector service.
- Publish an operations runbook and ADR or follow-up ticket; no infrastructure change is a valid outcome.

## Admin Evidence Gate

- Show retention and erasure health, access audit, workflow backlog/recovery, projection freshness, cache generation, load, latency, payload, storage growth, and error budgets.
- Reconcile the final graduation decision to measured evidence and name the owner of every follow-up.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Privacy and operational obligations remain acceptance gates in every earlier ticket; this is not the first lifecycle drill.
- Do not introduce specialized infrastructure without a measured constraint and rollback plan.
- Restored backups must replay privacy tombstones before serving traffic.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Exercise backlog recovery, retention failure, profile deletion with co-watch contribution, large candidate windows, burst ingestion, low-bandwidth clients, stale projections, cache rollback, restored backups, and worker outage.
- Produce a production-like capacity and privacy report plus SLO/error-budget review.
- Verify Admin operations evidence and the resulting ADR or roadmap follow-up.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
