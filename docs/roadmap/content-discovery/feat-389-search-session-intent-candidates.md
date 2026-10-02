---
id: "feat-389"
title: "Search and session-intent candidates"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: ""
duration: 5
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "search"
  - "intent"
  - "candidates"
---

## October 2, 2026 closeout disposition

Cancelled under the owner's final recommendation-roadmap scope decision.
A new search-query/session-intent candidate generator is optional expansion of the current semantic/profile/co-watch system and is retired. Existing search telemetry and session/durable separation remain. No query-to-recommendation training, generator rollout or usefulness improvement is claimed.

Audit anchors: `apps/admin/src/services/recommendations/candidate.ts`, `apps/admin/src/services/recommendations/profiles/projection.ts`, `apps/web/src/components/SearchOverlay.tsx`.
The audit establishes the current scope and code boundaries, not new production
verification. See [the consolidated closeout record](../../reports/2026-10-02-recommendation-roadmap-closeout.md)
for owner, PR, evidence and remaining operational work. The requirements below
are historical and do not authorize new implementation.

## Historical problem

Current search and session evidence can improve retrieval, but transient queries must not become permanent taste by default.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U22 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `session intent|query vector`
- `search.*candidate`
- `expiry|reformulation`

## What To Build

- Build short-lived query and session representations only from eligible search interactions.
- Retain query-to-playback evidence separately and nominate semantic candidates with expiry, source, and intent provenance.
- Replace or decay intent on reformulation and prohibit automatic promotion into durable interests.
- Run the generator in shadow and record a terminal decision.

## Admin Evidence Gate

- Show intent age, expiry, source evidence, coverage, overlap, novelty, rejection, downstream outcomes, and terminal decision.
- Show machine exclusion, no-result behavior, reformulation, and separation from durable profile interests.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- No-result and unselected queries are not positive interest evidence.
- Machine search never enters human session intent.
- The generator remains shadow-only and raw queries stay inside the short-lived search boundary.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test reformulation, expiry, no results, machine exclusion, disabling personalization, session-only use, and semantic fallback.
- Test privacy separation, generator latency, and candidate provenance.
- Reconcile intent evidence and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
