---
id: "feat-385"
title: "Hybrid recommendation promotion and rollback"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-384"
blocks:
  - "feat-447"
  - "feat-394"
  - "feat-395"
tags:
  - "admin"
  - "recommendations"
  - "promotion"
  - "rollback"
  - "experiments"
---

## Problem

Forge needs bounded automatic stage progression and emergency rollback without granting automation permanent-default authority.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U18 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `promotion|strategy pointer|kill switch`
- `rollback|last-known-good`
- `compare-and-swap|approval`

## What To Build

- Create an immutable promotion ledger, active-strategy pointer, pre-approved manifest digests and exposure ceilings, and compare-and-swap transitions.
- Advance a behaviorally equivalent semantic challenger through one bounded stage and rehearse an injected guardrail rollback.
- Separate approval, effective activation, first eligible exposure, rollback request, and rollback completion.
- Add authorized permanent-default confirmation, emergency kill switch, plain-language readiness, impact preview, and immutable audit.

## Admin Evidence Gate

- Show readiness, recommended next action, exposure ceiling, activation state, mature guardrails, last-known-good strategy, rollback progress, conflicts, and audit.
- Show pending, active, rollback-pending, complete, failed, stale-page, authorization-failure, and unavailable-fallback states clearly.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Automation can use only pre-approved manifests and bounded stages; a human role owns permanent default.
- Player startup and the coarse recommendation-surface kill switch must remain available during strategy failure.
- Rollback covers caches, assignments, stored slates, and pending workflows, not only the active pointer.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test concurrent approval, CSRF/recent-auth, unauthorized principals, stale claims, automatic/manual rollback, late evidence, unavailable challenger, repeated rollback, and immutable replay.
- Inject failure around promotion-event and pointer updates and prove atomicity.
- Reconcile every state transition and restored strategy in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
