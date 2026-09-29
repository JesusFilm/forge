---
id: "feat-574"
title: "Reduce recommendation event, served-item and profile storage growth"
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

Implement U1–U3 of the storage-efficiency plan. Prioritize measured low-risk physical and index changes; retain operational semantics and exact historical evidence. Report each material optimization and its native database benchmark, actual deployment and measured growth impact.

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

Implement U1–U3 of the storage-efficiency plan. Prioritize measured low-risk physical and index changes; retain operational semantics and exact historical evidence. Report each material optimization and its native database benchmark, actual deployment and measured growth impact.

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
