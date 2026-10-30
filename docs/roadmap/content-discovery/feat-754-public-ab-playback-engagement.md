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

Production verification: PR #2820 merged as `3628e166f`; migration 0162 applied
at `2026-10-20T02:29:26.756Z`. Saved report r2 at `2026-10-20T02:33:08.662Z`
contains both arms: 993 current / 1,011 saved eligible visits, 15 linked claims,
and two complete active-time outcomes. AB version 2 and the cohort dates remain
unchanged. The report is provisional; 13 claims have no published outcome yet.

Production visual verification found the report disclosure inherited the cohort
table's unbounded intrinsic width. Bound that disclosure to 40rem / 80vw so the
measure names and both values fit together. Verify it inside the actual parent
table, not only as a standalone comparison component.
