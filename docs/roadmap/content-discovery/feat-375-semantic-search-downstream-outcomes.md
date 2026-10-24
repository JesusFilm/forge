---
id: "feat-375"
title: "Semantic search downstream outcomes"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: ""
duration: 5
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "search"
  - "recommendations"
  - "telemetry"
---

## October 2, 2026 scope decision

Cancelled the proposed search-to-recommendation outcome graph and Admin funnel.
`apps/web/src/lib/watch-search-analytics.ts` and the configured GA/RUM paths
retain Watch search request and result-click signals; their existence does not
prove eligible exposure, an opaque search-to-playback join, reformulation
attribution or causal recommendation value. The bounded recommendation product
does not require this extra journey model or treat every search as durable taste.
Preserve working search and playback; a reproduced search failure is actionable
independently of this cancelled measurement expansion.

## Problem

Semantic search quality cannot be judged from result rendering or clicks alone; Forge needs downstream playback, mission value, and reformulation outcomes.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U8 contract.
2. `apps/web/src/components/SearchOverlay.tsx`
3. `apps/web/src/lib/search-actions.ts`
4. `apps/admin/src/services/recommendations/`
5. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `WatchSearchEvent|search request`
- `SearchOverlay|search-actions`
- `query|reformulation|no-result`

## What To Build

- Replace rendered-as-visible search logging with the shared eligible-exposure policy.
- Carry an opaque short-lived search discovery token to Watch and join selection, playback, mission action, and reformulation.
- Keep raw queries in the short-lived search boundary and separate transient session intent from durable profile interest.
- Publish per-signal readiness decisions for search exposure, selection, reformulation, and downstream outcome joins.

## Admin Evidence Gate

- Show query-to-eligible-impression, selection, start, qualified outcome, mission action, no-result, and reformulation funnels.
- Show unmatched joins, expiry, machine exclusion, acquisition context, and instrumentation health.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not add recommendation columns to the legacy WatchSearchEvent table.
- Never treat every query or click as durable taste.
- Normalize and encode all Admin-displayed query fields; machine search must not contaminate human learning.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test unseen rendered results, same/new-tab selection, expired handoff, reformulation, no results, Google acquisition plus search, and machine exclusion.
- Test request reconciliation, expiry, sanitization, retention, and erasure.
- Exercise search-to-Watch in a browser and reconcile it in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
