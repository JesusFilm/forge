---
id: "feat-575"
title: "Retire unprotected legacy recommendation trace detail early"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-09-30"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
---

## Problem

Implement U4 of the storage-efficiency plan. User authorized early retirement, superseding the prior expiry-only route for unprotected stage details. Preserve all protected observations and ordinary privacy expiry. This ticket does not close retention verification or physical reclamation.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-001-recommendation-storage-efficiency-plan.md` — authorized scope, units and release gates.
2. `apps/admin/prisma/schema.prisma` — request, item, fact, exposure, profile and trace models.
3. `apps/admin/src/services/recommendations/` — writers, readers and retention.
4. `docs/operations/legacy-recommendation-trace-conversion.md` — original private hold mechanism and parity proof.
5. `docs/operations/legacy-recommendation-stage-reclamation.md` — inactive exact-empty reclamation asset.

## Grep These

- `RecommendationServedItem|WatchSurfaceExposure|RecommendationProfileInterest`
- `trace_format_version|trace_payload|usesCompactCandidateTrace`
- `recommendation_render_event_key|toast_tuple_target`

## What To Build

Implement U4 of the storage-efficiency plan. User authorized early retirement, superseding the prior expiry-only route for unprotected stage details. Preserve all protected observations and ordinary privacy expiry. This ticket does not close retention verification or physical reclamation.

## Constraints

Only new task-owned agents may be used. Preserve ranking, learning, attribution,
29-day event/trace evidence except explicitly authorized unprotected legacy detail,
and configured profile expiry/erasure. No direct deployment, unreviewed retained
rewrite, CASCADE, or VACUUM FULL. No production writes by child agents.

## Verification

Native PostgreSQL exact-value/reader/expiry tests and physical table/index/TOAST/WAL
benchmarks; relevant unit/type/lint/migration/format checks; independent review;
normal PR-to-main deployment and actual fleet health and filesystem measurements.
Keep status in progress until the full intended production result is verified.

## September 30 Rollout Evidence

See `docs/reports/2026-09-30-recommendation-storage-rollout.md` for reviewed PRs,
actual deployment state, the finite retirement pilot and open activation gates.
This ticket remains in progress. Local byte reductions and row deletion are not
credited as production filesystem savings.

This ticket was renumbered from feat-572 to feat-575 after concurrent roadmap
work reused feat-572. Historical pilot receipts retain the original number. The
pilot preserved all 64 original quality holdouts and 8,621 observations, retired
1,062 unprotected observations and losslessly converted one protected observation.
Later finite cohorts require fresh review; the pilot does not authorize a loop.
