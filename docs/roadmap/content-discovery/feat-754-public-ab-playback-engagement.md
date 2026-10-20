---
id: "feat-754"
title: "Compare playback engagement alongside public recommendation CTR"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 3
depends_on:
  - "feat-746"
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "analytics"
---

## Problem

The running editorial A/B measures clicks but does not connect existing playback
outcomes to its results. The owner requested CTR, engaged-view rate, active watch
minutes per 100 eligible visits, and explicit playback tracking coverage.

## Implementation

Extend `apps/admin/src/services/recommendations/precomputed/ctr-evidence.ts`,
`ctr-report.ts`, the retained totals/cluster models, and Admin report controls.
Join exact accepted-click/claimed-playback lineage to the latest
`active-watch-proxy-v1` outcome. Archive aggregates before raw expiry; distinguish
unmeasured old archives from zero engagement. Keep the running cohort intact.

## Verification

Native PostgreSQL attribution and archive parity, report revision compatibility,
coverage/missing outcome handling, browser-cluster uncertainty, Admin rendering,
types/lint/format, and production report readback after normal deployment.

## Reference

- `docs/plans/2026-10-20-002-public-ab-engagement-plan.md`

## Completion evidence

43 focused tests pass, including native PostgreSQL report/retention and the real
playback outcome service in both arms. Scoped TypeScript, touched ESLint and
local browser rendering pass. No new Watch request or dependency was added.
The additive migration and production report are verified during normal release.

- `docs/operations/precomputed-ctr-report.md#playback-engagement-alongside-ctr`
- `docs/solutions/architecture-patterns/precomputed-ab-playback-engagement-20261020.md`
